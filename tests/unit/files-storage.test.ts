import { it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import {
  importScoreFile,
  exportMxl,
  unpackMxl,
  toBase64,
  fromBase64,
} from '../../client/src/storage/files';
import {
  newProject,
  parseProject,
  saveProject,
  listProjects,
} from '../../client/src/storage/projects';
import { createPianoScore, changePitch } from '../../client/src/music/editor';
import { parseScore } from '../../client/src/music/score';
const xml = createPianoScore('附件保留');
const container =
  '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="scores/main.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
const original = zipSync({
  'META-INF/container.xml': strToU8(container),
  'scores/main.musicxml': strToU8(xml),
  'images/original.png': new Uint8Array([137, 80, 78, 71]),
  'attachments/extension.xml': strToU8('<private value="unchanged"/>'),
});
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
it('uses the declared MXL root file and retains every archive attachment', () => {
  const parsed = unpackMxl(original);
  expect(parsed.rootPath).toBe('scores/main.musicxml');
  expect(parsed.xml).toBe(xml);
  const edited = changePitch(xml, 'p0m0n0', { step: 'E', alter: 0, octave: 4 });
  const packed = exportMxl(edited, toBase64(original));
  const files = unzipSync(packed);
  expect(files['images/original.png']).toEqual(
    new Uint8Array([137, 80, 78, 71]),
  );
  expect(strFromU8(files['attachments/extension.xml'])).toBe(
    '<private value="unchanged"/>',
  );
  expect(parseScore(unpackMxl(packed).xml).notes[0].step).toBe('E');
});
it('rejects archives without a container rather than choosing a random XML', () => {
  expect(() => unpackMxl(zipSync({ 'random.xml': strToU8(xml) }))).toThrow(
    'container.xml',
  );
});
it('rejects archive traversal entries', () => {
  expect(() => unpackMxl(zipSync({ '../bad.xml': strToU8(xml) }))).toThrow(
    '不安全',
  );
});
it('imports raw XML while retaining the exact original bytes', async () => {
  const bytes = strToU8(xml),
    file = {
      name: 'score.musicxml',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    } as File;
  const result = await importScoreFile(file);
  expect(result.xml).toBe(xml);
  expect(fromBase64(result.originalData)).toEqual(bytes);
});
it('can make a standards-container MXL from a new project', () => {
  expect(unpackMxl(exportMxl(xml)).xml).toBe(xml);
});
it('round-trips original XML, draft, images, archive and recognition metadata in the project file', () => {
  const p = {
    ...newProject(xml),
    draft: '<invalid draft>',
    image: { name: 'scan.png', dataUrl: 'data:image/png;base64,iVBORw==' },
    source: {
      xml,
      sourceName: 'scan.mxl',
      originalData: toBase64(original),
      archive: toBase64(original),
      warnings: [],
    },
    recognition: {
      staves: [{ cx: 0.5, cy: 0.3, w: 0.8, h: 0.1 }],
      texts: [{ text: 'original' }],
    },
    checked: ['p0m0n0'],
  };
  const roundtrip = parseProject(JSON.stringify(p));
  expect(roundtrip.id).not.toBe(p.id);
  expect({ ...roundtrip, id: p.id, updatedAt: p.updatedAt }).toEqual(p);
});
it('validates project versions and rejects scriptable image URLs', () => {
  const p = newProject(xml);
  expect(() => parseProject(JSON.stringify({ ...p, schema: 9 }))).toThrow(
    '版本',
  );
  expect(() =>
    parseProject(
      JSON.stringify({
        ...p,
        image: { name: 'x', dataUrl: 'javascript:alert(1)' },
      }),
    ),
  ).toThrow('原图格式');
});
it('stores full projects in IndexedDB and keeps independent projects', async () => {
  const a = newProject(xml, 'A'),
    b = newProject(xml, 'B');
  a.draft = '<unapplied>';
  await saveProject(a);
  await saveProject(b);
  a.title = 'Updated';
  await saveProject(a);
  const all = await listProjects();
  expect(all).toHaveLength(2);
  expect(all.find((p) => p.id === a.id)?.draft).toBe('<unapplied>');
  expect(all.find((p) => p.id === a.id)?.title).toBe('Updated');
});
it('ignores stale autosaves instead of overwriting a newer snapshot', async () => {
  const p = newProject(xml);
  await saveProject({ ...p, title: 'new', updatedAt: 200 });
  await saveProject({ ...p, title: 'old', updatedAt: 100 });
  expect((await listProjects())[0].title).toBe('new');
});
