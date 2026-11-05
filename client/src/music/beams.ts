import {
  parseScore,
  serialize,
  child,
  kids,
  put,
  make,
  type Score,
  type ScoreNote,
} from './score';
import { moveNote } from './editor';

const levels: Record<string, number> = {
  eighth: 1,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
  '128th': 5,
};
const NO_BEAM = 'puxie-no-beam';
const EPS = 1e-7;

function noBeamMarkers(note: ScoreNote) {
  return Array.from(note.element.childNodes).filter(
    (node) => node.nodeType === 7 && node.nodeName === NO_BEAM,
  );
}

export function isBeamSuppressed(note: ScoreNote) {
  return noBeamMarkers(note).length > 0;
}

interface BeamEvent {
  root: ScoreNote;
  tones: ScoreNote[];
}

const beams = (event: BeamEvent) =>
  event.tones.flatMap((n) => kids(n.element, 'beam'));
const beamLevel = (beam: Element) => Number(beam.getAttribute('number') || '1');

function primary(event: BeamEvent) {
  const values = new Set(
    beams(event)
      .filter((b) => beamLevel(b) === 1)
      .map((b) => b.textContent?.trim()),
  );
  if (values.size > 1)
    throw new Error('和弦内的连梁记号不一致，请在 XML 中修正');
  return values.values().next().value;
}

function beamSelection(score: Score, ids: string[]) {
  const selected = ids.map((id) => score.notes.find((n) => n.id === id));
  const first = selected[0];
  if (!first || score.readonly) throw new Error('请先选择可编辑音符');
  if (
    selected.some(
      (n) =>
        !n ||
        n.partIndex !== first.partIndex ||
        n.measureIndex !== first.measureIndex ||
        n.staff !== first.staff ||
        n.voice !== first.voice,
    )
  )
    throw new Error('请选择同一小节、同一谱表及同一声部的音符');

  const events: BeamEvent[] = [];
  const byId = new Map<string, BeamEvent>();
  for (const n of score.parts[first.partIndex].measures[first.measureIndex]
    .notes) {
    if (!n.chord) events.push({ root: n, tones: [] });
    const event = events.at(-1)!;
    event.tones.push(n);
    byId.set(n.id, event);
  }
  const voice = events
    .filter(
      ({ root }) => root.staff === first.staff && root.voice === first.voice,
    )
    .sort((a, b) => a.root.onset - b.root.onset);
  const indexes = [
    ...new Set(ids.map((id) => voice.indexOf(byId.get(id)!))),
  ].sort((a, b) => a - b);
  if (indexes[0] < 0) throw new Error('跨谱表和弦请使用 XML 编辑连梁');
  return { voice, indexes };
}

function selectedGroup(score: Score, ids: string[]) {
  const { voice, indexes } = beamSelection(score, ids);
  if (indexes.length < 2) throw new Error('请至少选择两个不同位置的音符或和弦');
  if (indexes.some((index, i) => index !== indexes[0] + i))
    throw new Error('请选择连续音符，中间不能漏选音符');
  return { voice, indexes, group: indexes.map((index) => voice[index]) };
}

function bounds(voice: BeamEvent[], index: number): [number, number] {
  if (!beams(voice[index]).length) return [index, index];
  let first = index;
  let last = index;
  while (first > 0 && ['continue', 'end'].includes(primary(voice[first]) || ''))
    first--;
  while (
    last < voice.length - 1 &&
    ['begin', 'continue'].includes(primary(voice[last]) || '')
  )
    last++;
  if (
    first === last ||
    primary(voice[first]) !== 'begin' ||
    primary(voice[last]) !== 'end' ||
    voice.slice(first + 1, last).some((event) => primary(event) !== 'continue')
  )
    throw new Error('连梁不完整或跨小节，请在 XML 中检查 begin/end');
  return [first, last];
}

function checkNotes(events: BeamEvent[]) {
  for (const event of events) {
    const n = event.root;
    if (
      event.tones.some(
        (tone) =>
          tone.staff !== n.staff ||
          !levels[tone.type] ||
          tone.rest ||
          tone.grace ||
          tone.cue ||
          child(tone.element, 'time-modification'),
      )
    )
      throw new Error(
        '此操作支持同谱表的八分及更短普通音符。休止、倚音或连音组请使用 XML',
      );
    if (
      beams(event).some(
        (b) =>
          b.namespaceURI !== n.element.namespaceURI ||
          Array.from(b.attributes).some((a) => a.name !== 'number') ||
          Array.from(b.childNodes).some(
            (c) => c.nodeType !== 3 && c.nodeType !== 4,
          ),
      )
    )
      throw new Error('连梁含手工样式或扩展，请使用 XML 编辑以保留信息');
  }
}

function checkAdjacent(group: BeamEvent[]) {
  for (let i = 1; i < group.length; i++) {
    const prev = group[i - 1].root;
    const gap = group[i].root.onset - (prev.onset + prev.duration);
    if (gap < -EPS) throw new Error('所选音符起拍有重叠，请先修正时值或起拍');
    if (gap > EPS)
      throw new Error('所选音符之间有空隙，可多选后使用「贴齐起拍并连梁」');
  }
}

function alignmentMoves(group: BeamEvent[]) {
  checkNotes(group);
  const moves: { note: ScoreNote; onset: number }[] = [];
  let onset = group[0].root.onset;
  let previousEnd = onset;
  for (const { root } of group) {
    if (root.onset < previousEnd - EPS)
      throw new Error('所选音符起拍有重叠，请先修正时值或起拍');
    if (root.onset > onset + EPS) moves.push({ note: root, onset });
    onset += root.duration;
    previousEnd = root.onset + root.duration;
  }
  return moves;
}

export function previewBeamAlignment(score: Score, ids: string[]) {
  return alignmentMoves(selectedGroup(score, ids).group);
}

function unbeam(event: BeamEvent) {
  beams(event).forEach((b) => b.remove());
  const note = event.root;
  if (!isBeamSuppressed(note))
    note.element.appendChild(
      note.element.ownerDocument.createProcessingInstruction(NO_BEAM, ''),
    );
}

function writeBeam(group: BeamEvent[]) {
  for (const event of group) {
    beams(event).forEach((b) => b.remove());
    for (const tone of event.tones)
      noBeamMarkers(tone).forEach((marker) => marker.remove());
  }
  const maxLevel = Math.max(...group.map(({ root }) => levels[root.type]));
  for (let level = 1; level <= maxLevel; level++) {
    for (const [i, { root: n }] of group.entries()) {
      if (levels[n.type] < level) continue;
      const before = i > 0 && levels[group[i - 1].root.type] >= level;
      const after =
        i < group.length - 1 && levels[group[i + 1].root.type] >= level;
      const value = before
        ? after
          ? 'continue'
          : 'end'
        : after
          ? 'begin'
          : i
            ? 'backward hook'
            : 'forward hook';
      const beam =
        level === 1
          ? put(n.element, 'beam', value)
          : make(n.element, 'beam', value);
      beam.setAttribute('number', String(level));
      if (level > 1)
        n.element.insertBefore(
          beam,
          kids(n.element, 'beam').at(-1)!.nextSibling,
        );
    }
  }
}

function closeFragment(group: BeamEvent[]) {
  if (group.length === 1) {
    unbeam(group[0]);
    return;
  }
  if (group.length === 0) return;
  // Retain interior and secondary breaks. Only close beams at the new edges.
  for (const [edge, neighbor, first] of [
    [group[0], group[1], true],
    [group.at(-1)!, group.at(-2)!, false],
  ] as const) {
    for (const b of beams(edge)) {
      const value = b.textContent?.trim();
      const outgoing = first
        ? ['continue', 'end', 'backward hook']
        : ['continue', 'begin', 'forward hook'];
      if (!outgoing.includes(value || '')) continue;
      const connecting = first ? ['continue', 'end'] : ['continue', 'begin'];
      const connected =
        value === 'continue' &&
        beams(neighbor).some(
          (next) =>
            beamLevel(next) === beamLevel(b) &&
            connecting.includes(next.textContent?.trim() || ''),
        );
      b.textContent = connected
        ? first
          ? 'begin'
          : 'end'
        : first
          ? 'forward hook'
          : 'backward hook';
    }
  }
}

function detach(voice: BeamEvent[], indexes: number[]) {
  const selected = new Set(indexes);
  const ranges = new Map<number, number>();
  for (const index of indexes) {
    const [first, last] = bounds(voice, index);
    ranges.set(first, last);
  }
  for (const [first, last] of ranges) {
    checkNotes(voice.slice(first, last + 1));
    let fragment: BeamEvent[] = [];
    for (let i = first; i <= last; i++) {
      if (selected.has(i)) {
        closeFragment(fragment);
        fragment = [];
        unbeam(voice[i]);
      } else {
        fragment.push(voice[i]);
      }
    }
    closeFragment(fragment);
  }
}

export function joinBeam(xml: string, id: string) {
  const score = parseScore(xml);
  const {
    voice,
    indexes: [index],
  } = beamSelection(score, [id]);
  if (!voice[index + 1]) throw new Error('当前小节同声部没有下一音符');
  const left = bounds(voice, index);
  const right = bounds(voice, index + 1);
  if (left[1] !== index || right[0] !== index + 1)
    throw new Error('这两个音符已在同一连梁组中');
  const group = voice.slice(left[0], right[1] + 1);
  checkNotes(group);
  checkAdjacent(group);
  writeBeam(group);
  return serialize(score);
}

export function clearBeam(xml: string, id: string) {
  const score = parseScore(xml);
  const {
    voice,
    indexes: [index],
  } = beamSelection(score, [id]);
  const [first, last] = bounds(voice, index);
  detach(
    voice,
    Array.from({ length: last - first + 1 }, (_, i) => first + i),
  );
  return serialize(score);
}

export function joinSelectedBeams(xml: string, ids: string[]) {
  const score = parseScore(xml);
  const { voice, indexes, group } = selectedGroup(score, ids);
  checkNotes(group);
  checkAdjacent(group);
  detach(voice, indexes);
  writeBeam(group);
  return serialize(score);
}

export function alignAndJoinSelectedBeams(xml: string, ids: string[]) {
  const score = parseScore(xml);
  const { voice, indexes, group } = selectedGroup(score, ids);
  const moves = alignmentMoves(group);
  detach(voice, indexes);
  let updated = serialize(score);
  // Earliest first so each move can use the space freed by the preceding event.
  for (const { note, onset } of moves)
    updated = moveNote(updated, note.id, onset);
  return joinSelectedBeams(updated, ids);
}

export function clearSelectedBeams(xml: string, ids: string[]) {
  const score = parseScore(xml);
  const { voice, indexes } = beamSelection(score, ids);
  detach(voice, indexes);
  return serialize(score);
}
