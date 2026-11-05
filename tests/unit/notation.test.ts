import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseScore,
  kids,
  descendants,
  put,
  serialize,
} from '../../client/src/music/score';
import {
  addChordTone,
  changeRhythm,
  moveNote,
} from '../../client/src/music/editor';
import {
  joinBeam,
  clearBeam,
  joinSelectedBeams,
  clearSelectedBeams,
  isBeamSuppressed,
  previewBeamAlignment,
  alignAndJoinSelectedBeams,
} from '../../client/src/music/beams';
import { buildTimeline } from '../../client/src/music/timeline';
const xml = readFileSync('tests/fixtures/piano-rhythm.musicxml', 'utf8');
it('moves the original chord to a free beat without shifting other notes or losing lyrics', () => {
  const short = changeRhythm(xml, 'p0m0n3', '16th', 0);
  const chord = addChordTone(short, 'p0m0n3', {
    step: 'A',
    alter: 0,
    octave: 4,
  });
  const before = parseScore(chord);
  const moved = parseScore(moveNote(chord, 'p0m0n4', 1.25));
  expect(moved.notes.map((n) => n.onset)).toEqual(
    before.notes.map((n) =>
      ['p0m0n3', 'p0m0n4'].includes(n.id) ? 1.25 : n.onset,
    ),
  );
  expect(moved.notes.map((n) => n.duration)).toEqual(
    before.notes.map((n) => n.duration),
  );
  expect(descendants(moved.document, 'lyric')[0].textContent).toBe('保留');
  expect(
    parseScore(moveNote(serialize(moved), 'p0m0n4', 1)).notes.map(
      (n) => n.onset,
    ),
  ).toEqual(before.notes.map((n) => n.onset));
});
it('rejects moving onto another note, beyond the bar, or with an attached tie', () => {
  expect(() => moveNote(xml, 'p0m0n3', 1.25)).toThrow('空拍');
  expect(() => moveNote(xml, 'p0m0n3', 4)).toThrow('当前小节');
  expect(() => moveNote(xml, 'p0m0n2', 0.25)).toThrow('连线');
});
it('mixed eighth/sixteenth beams keep the secondary hook and MusicXML element order', () => {
  const source = parseScore(changeRhythm(xml, 'p0m0n7', '16th', 0, true));
  put(source.notes[7].element, 'play');
  const before = serialize(source),
    joined = parseScore(joinBeam(before, 'p0m0n6'));
  const note = joined.notes[7].element;
  expect(
    kids(note, 'beam').map((b) => [b.getAttribute('number'), b.textContent]),
  ).toEqual([
    ['1', 'end'],
    ['2', 'backward hook'],
  ]);
  expect(kids(note).findIndex((e) => e.localName === 'play')).toBeGreaterThan(
    kids(note)
      .map((e) => e.localName)
      .lastIndexOf('beam'),
  );
  expect(buildTimeline(serialize(joined))).toEqual(buildTimeline(before));
});
it('ripple refuses to discard cursor comments or independent trailing time placeholders', () => {
  expect(() =>
    changeRhythm(
      xml.replace('<backup>', '<backup><!-- retain me -->'),
      'p0m0n6',
      'eighth',
      0,
      true,
    ),
  ).toThrow('扩展');
  const trailing = xml.replace(
    '</measure><measure number="2">',
    '<forward><duration>120</duration></forward></measure><measure number="2">',
  );
  expect(() => changeRhythm(trailing, 'p0m0n6', 'eighth', 0, true)).toThrow(
    '尾部',
  );
});
it('manual beams join/extend groups without changing pitch, timing, ties or lyrics', () => {
  const joined = joinBeam(joinBeam(xml, 'p0m0n3'), 'p0m0n5');
  expect(buildTimeline(joined)).toEqual(buildTimeline(xml));
  const notes = parseScore(joined).notes;
  expect(
    ['p0m0n3', 'p0m0n5', 'p0m0n6'].map(
      (id) =>
        kids(notes.find((n) => n.id === id)!.element, 'beam')[0].textContent,
    ),
  ).toEqual(['begin', 'continue', 'end']);
  expect(descendants(parseScore(joined).document, 'lyric')[0].textContent).toBe(
    '保留',
  );
  expect(
    kids(parseScore(clearBeam(joined, 'p0m0n5')).notes[3].element, 'beam'),
  ).toHaveLength(0);
});
it('manual beam rejects a rest, nonadjacent notes, and existing styled beam', () => {
  expect(() => joinBeam(xml, 'p0m0n0')).toThrow('八分');
  const joined = joinBeam(xml, 'p0m0n3').replace(
    '<beam number="1">',
    '<beam number="1" color="#123456">',
  );
  expect(() => clearBeam(joined, 'p0m0n3')).toThrow('样式');
});
it('can clear part of a beam and rejoin the selected notes while preserving the remaining group', () => {
  const ids = ['p0m0n3', 'p0m0n5', 'p0m0n6', 'p0m0n7', 'p0m0n8'];
  const joined = joinSelectedBeams(xml, ids);
  const cleared = clearSelectedBeams(joined, [ids[2], ids[3]]);
  const notes = (source: string) => {
    const parsed = parseScore(source);
    return ids.map((id) => parsed.notes.find((n) => n.id === id)!);
  };
  const layout = (source: string) =>
    notes(source).map((n) => kids(n.element, 'beam')[0]?.textContent);
  expect(layout(cleared)).toEqual([
    'begin',
    'end',
    undefined,
    undefined,
    undefined,
  ]);
  expect(notes(cleared).map(isBeamSuppressed)).toEqual([
    false,
    false,
    true,
    true,
    true,
  ]);
  const rejoined = joinSelectedBeams(cleared, [ids[3], ids[2]]);
  expect(layout(rejoined)).toEqual(['begin', 'end', 'begin', 'end', undefined]);
  expect(notes(rejoined).map(isBeamSuppressed)).toEqual([
    false,
    false,
    false,
    false,
    true,
  ]);
  expect(buildTimeline(rejoined)).toEqual(buildTimeline(xml));
});
it('rejects joining a selection that skips a note or spans voices', () => {
  expect(() => joinSelectedBeams(xml, ['p0m0n3', 'p0m0n6'])).toThrow('漏选');
  expect(() => joinSelectedBeams(xml, ['p0m0n3', 'p0m0n2'])).toThrow(
    '同一声部',
  );
});
it('closes a timing gap after a chord only on explicit request and keeps other anchors', () => {
  const short = changeRhythm(xml, 'p0m0n3', '16th', 0);
  const source = addChordTone(short, 'p0m0n3', {
    step: 'A',
    alter: 0,
    octave: 4,
  });
  const ids = ['p0m0n4', 'p0m0n6', 'p0m0n7'];
  const before = parseScore(source);
  expect(() => joinSelectedBeams(source, ids)).toThrow('空隙');
  expect(
    previewBeamAlignment(before, ids).map(({ note, onset }) => [
      note.id,
      note.onset,
      onset,
    ]),
  ).toEqual([
    ['p0m0n6', 1.5, 1.25],
    ['p0m0n7', 2, 1.75],
  ]);
  const aligned = parseScore(alignAndJoinSelectedBeams(source, ids));
  expect(aligned.notes.map((n) => [n.id, n.onset, n.duration, n.midi])).toEqual(
    before.notes.map((n) => [
      n.id,
      ids.slice(1).includes(n.id) ? n.onset - 0.25 : n.onset,
      n.duration,
      n.midi,
    ]),
  );
  expect(aligned.tempos).toEqual(before.tempos);
  expect(
    aligned.notes
      .slice(3, 8)
      .map((n) => kids(n.element, 'beam')[0]?.textContent),
  ).toEqual(['begin', undefined, undefined, 'continue', 'end']);
  expect(descendants(aligned.document, 'lyric')[0].textContent).toBe('保留');
  expect(aligned.notes[2].element.outerHTML).toBe(
    before.notes[2].element.outerHTML,
  );
});
it('clears beams on gapped source notes without retiming them', () => {
  const source = parseScore(joinSelectedBeams(xml, ['p0m0n3', 'p0m0n5']));
  const first = source.notes[3];
  put(first.element, 'duration', '120');
  put(first.element, 'type', '16th');
  const gapped = serialize(source).replace(
    '</lyric></note>',
    '</lyric></note><forward><duration>120</duration></forward>',
  );
  const cleared = clearSelectedBeams(gapped, ['p0m0n3', 'p0m0n5']);
  expect(buildTimeline(cleared)).toEqual(buildTimeline(gapped));
  expect(parseScore(cleared).notes.slice(3, 6).map(isBeamSuppressed)).toEqual([
    true,
    false,
    true,
  ]);
});
it('initial separate attributes blocks remain editable while mid-measure changes are protected', () => {
  expect(
    parseScore(changeRhythm(xml, 'p0m0n6', 'eighth', 0)).notes[6].duration,
  ).toBe(0.5);
  const mid = xml.replace(
    '<backup><duration>240</duration></backup>',
    '<attributes><key><fifths>1</fifths></key></attributes><backup><duration>240</duration></backup>',
  );
  expect(() => changeRhythm(mid, 'p0m0n6', 'eighth', 0)).toThrow('中途属性');
});
it('ripple corrects a dotted note and shifts only the selected staff/voice', () => {
  const original = parseScore(xml),
    changed = parseScore(changeRhythm(xml, 'p0m0n6', 'eighth', 0, true));
  expect(changed.notes[6].duration).toBe(0.5);
  expect(changed.notes[7].onset).toBe(2.5);
  expect(changed.notes[8].onset).toBe(3.25);
  expect(
    changed.notes
      .filter((n) => n.staff === 2)
      .map((n) => [n.id, n.onset, n.duration]),
  ).toEqual(
    original.notes
      .filter((n) => n.staff === 2)
      .map((n) => [n.id, n.onset, n.duration]),
  );
  expect(changed.parts[0].measures[1].start).toBe(4);
  expect(descendants(changed.document, 'tied')).toHaveLength(2);
});
it('ripple can lengthen into the following voice notes but refuses overflow and complex cursor nodes', () => {
  expect(() => changeRhythm(xml, 'p0m0n6', 'quarter', 0, true)).toThrow('超出');
  const short = changeRhythm(xml, 'p0m0n6', 'eighth', 0, true);
  const restored = parseScore(changeRhythm(short, 'p0m0n6', 'eighth', 1, true));
  expect(restored.notes[7].onset).toBe(2.75);
  expect(() =>
    changeRhythm(
      xml.replace('<backup>', '<backup id="keep">'),
      'p0m0n6',
      'eighth',
      0,
      true,
    ),
  ).toThrow('扩展');
});
