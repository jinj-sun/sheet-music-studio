import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeRecognizedPages } from '../../client/src/omr/merge-pages';
import { recognizePages } from '../../client/src/omr/batch';
import { parseScore, descendants } from '../../client/src/music/score';
import { newProject, parseProject } from '../../client/src/storage/projects';
import {
  pageXml,
  projectPages,
  type ProjectPage,
} from '../../client/src/storage/pages';
import type { RecognizeResult } from '../../client/src/omr/recognizer';
const xml = readFileSync('tests/fixtures/piano-rhythm.musicxml', 'utf8');
const image = { name: 'test.png', dataUrl: 'data:image/png;base64,iVBORw==' };
const page = (id: string): ProjectPage => ({
  id,
  image: { ...image, name: `page-${id}.png` },
});
const success = (musicXml = xml): RecognizeResult => ({
  ok: true,
  error: '',
  musicXml,
  backend: 'wasm',
  durationMs: 2,
  engine: 'browser',
  log: '',
  staves: [],
  texts: [],
  tablature: [],
});
it('merges complete DOM measures with contiguous numbers, page ranges, ties and lyrics', () => {
  const second = xml
    .replace('<text>保留</text>', '<text>第二页</text>')
    .replace(
      '<step>E</step><octave>4</octave>',
      '<step>F</step><octave>4</octave>',
    );
  const result = mergeRecognizedPages([xml, second]),
    parsed = parseScore(result.xml);
  expect(result.ranges).toEqual([
    { start: 0, count: 2 },
    { start: 2, count: 2 },
  ]);
  expect(parsed.parts[0].measures.map((m) => m.number)).toEqual([
    '1',
    '2',
    '3',
    '4',
  ]);
  expect(parsed.notes).toHaveLength(32);
  expect(parsed.notes.find((n) => n.id === 'p0m2n3')).toMatchObject({
    step: 'F',
    onset: 1,
    start: 9,
  });
  expect(
    descendants(parsed.document, 'lyric').map((e) => e.textContent),
  ).toEqual(['保留', '第二页']);
  expect(descendants(parsed.document, 'tied')).toHaveLength(4);
  expect(
    descendants(parsed.document, 'print')[0].getAttribute('new-page'),
  ).toBe('yes');
  expect(mergeRecognizedPages([xml]).xml).toBe(xml);
});
it('refuses incompatible part definitions and colliding declared IDs without rewriting input', () => {
  expect(() =>
    mergeRecognizedPages([
      xml,
      xml.replace(
        '<part-name>Piano</part-name>',
        '<part-name>Violin</part-name>',
      ),
    ]),
  ).toThrow('第 2 页');
  const sameId = xml.replace(
    '<measure number="1">',
    '<measure number="1" id="shared">',
  );
  expect(() => mergeRecognizedPages([sameId, sameId])).toThrow('重复 XML ID');
  expect(() =>
    mergeRecognizedPages([
      xml,
      xml
        .replace('<staves>2</staves>', '<staves>1</staves>')
        .replaceAll('<staff>2</staff>', '<staff>1</staff>'),
    ]),
  ).toThrow('谱表数');
});
it('isolates page divisions and rejects ambiguous inherited meter', () => {
  const mini = (attrs: string, dur: number) =>
    `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes>${attrs}</attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>${dur}</duration><type>quarter</type></note></measure></part></score-partwise>`;
  const merged = parseScore(
    mergeRecognizedPages([mini('<divisions>8</divisions>', 8), mini('', 1)])
      .xml,
  );
  expect(merged.notes.map((n) => [n.start, n.duration])).toEqual([
    [0, 1],
    [4, 1],
  ]);
  expect(() =>
    mergeRecognizedPages([
      mini('<time><beats>3</beats><beat-type>4</beat-type></time>', 1),
      mini('', 1),
    ]),
  ).toThrow('跨页继承');
});
it('keeps successful pages on a middle failure and retries only the missing page in order', async () => {
  const snapshots: ProjectPage[][] = [],
    progress: number[] = [];
  const infer = vi
    .fn<Parameters<typeof recognizePages>[1]>()
    .mockResolvedValueOnce(success())
    .mockResolvedValueOnce({
      ...success(),
      ok: false,
      error: 'not_music',
      musicXml: '',
      staves: [],
      texts: [],
      tablature: [],
    })
    .mockResolvedValueOnce(success());
  const hooks = {
    onProgress: (p: { page: number }) => progress.push(p.page),
    onPage: (p: ProjectPage[]) => {
      snapshots.push(p);
    },
  };
  const first = await recognizePages(
    [page('1'), page('2'), page('3')],
    infer,
    new AbortController().signal,
    hooks,
  );
  expect(progress).toEqual([1, 2, 3]);
  expect(first.map((p) => !!pageXml(p))).toEqual([true, false, true]);
  expect(first[1].error).toContain('未检测到');
  expect(snapshots[0][0].recognition?.musicXml).toBe(xml);
  infer.mockResolvedValue(success());
  const retry = await recognizePages(
    first,
    infer,
    new AbortController().signal,
    hooks,
  );
  expect(infer).toHaveBeenCalledTimes(4);
  expect(progress).toEqual([1, 2, 3, 2]);
  expect(retry.every((p) => pageXml(p) === xml)).toBe(true);
});
it('cancellation preserves completed checkpoints and ignores a late result', async () => {
  const controller = new AbortController(),
    onPage = vi.fn();
  const infer = vi
    .fn<Parameters<typeof recognizePages>[1]>()
    .mockResolvedValueOnce(success())
    .mockImplementationOnce(async () => {
      controller.abort();
      return success();
    });
  await expect(
    recognizePages(
      [page('1'), page('2'), page('3')],
      infer,
      controller.signal,
      { onPage, onProgress: vi.fn() },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(infer).toHaveBeenCalledTimes(2);
  expect(onPage).toHaveBeenCalledOnce();
  expect(pageXml(onPage.mock.calls[0][0][0])).toBe(xml);
});
it('round-trips every original, raw page XML, failed-page metadata and order', () => {
  const pages = [
    { ...page('2'), recognition: success(), range: { start: 0, count: 2 } },
    { ...page('1'), error: 'cannot decode' },
  ];
  const p = { ...newProject(xml), pages };
  const copy = parseProject(JSON.stringify(p));
  expect(copy.id).not.toBe(p.id);
  expect(projectPages(copy)).toEqual(pages);
  expect(
    projectPages(parseProject(JSON.stringify({ ...newProject(xml), image })))[0]
      .image,
  ).toEqual(image);
  expect(() =>
    parseProject(JSON.stringify({ ...p, pages: [pages[0], pages[0]] })),
  ).toThrow('格式无效');
});
