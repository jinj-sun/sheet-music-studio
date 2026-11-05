import {
  parseScore,
  serialize,
  child,
  kids,
  put,
  make,
  type ScoreNote,
} from './score';
const levels: Record<string, number> = {
  eighth: 1,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
  '128th': 5,
};
const primary = (n: ScoreNote) =>
  kids(n.element, 'beam')
    .find((e) => (e.getAttribute('number') || '1') === '1')
    ?.textContent?.trim();
function roots(xml: string, id: string) {
  const score = parseScore(xml),
    selected = score.notes.find((n) => n.id === id);
  if (!selected || score.readonly) throw new Error('请先选择可编辑音符');
  const notes = score.notes
    .filter(
      (n) =>
        n.partIndex === selected.partIndex &&
        n.measureIndex === selected.measureIndex &&
        n.staff === selected.staff &&
        n.voice === selected.voice &&
        !n.chord,
    )
    .sort((a, b) => a.onset - b.onset);
  const stream =
    score.parts[selected.partIndex].measures[selected.measureIndex].notes;
  let rootIndex = stream.indexOf(selected);
  while (stream[rootIndex]?.chord) rootIndex--;
  const root = stream[rootIndex];
  if (!root || !notes.includes(root))
    throw new Error('无法唯一定位和弦主音，请使用 XML 编辑');
  return { score, notes, index: notes.indexOf(root) };
}
function bounds(notes: ScoreNote[], index: number): [number, number] {
  if (!primary(notes[index])) return [index, index];
  let first = index,
    last = index;
  while (first > 0 && primary(notes[first]) !== 'begin') first--;
  while (last < notes.length - 1 && primary(notes[last]) !== 'end') last++;
  if (primary(notes[first]) !== 'begin' || primary(notes[last]) !== 'end')
    throw new Error('连梁不完整，请在 XML 中修复 begin/end');
  return [first, last];
}
function check(notes: ScoreNote[]) {
  for (const [i, n] of notes.entries()) {
    if (
      !levels[n.type] ||
      n.rest ||
      n.grace ||
      child(n.element, 'time-modification')
    )
      throw new Error(
        '此操作支持同声部连续的八分及更短普通音符；休止、倚音、连音组或跨小节连梁请使用 XML',
      );
    if (
      i &&
      Math.abs(notes[i - 1].onset + notes[i - 1].duration - n.onset) > 1e-7
    )
      throw new Error('只能连接时间上相邻的音符');
    if (
      kids(n.element, 'beam').some(
        (b) =>
          Array.from(b.attributes).some((a) => a.name !== 'number') ||
          kids(b).length ||
          Array.from(b.childNodes).some((c) => c.nodeType === 8),
      )
    )
      throw new Error('连梁含手工样式或扩展，请使用 XML 编辑以保留信息');
  }
}
export function joinBeam(xml: string, id: string) {
  const { score, notes, index } = roots(xml, id),
    next = notes[index + 1];
  if (!next) throw new Error('当前小节同声部没有下一音符');
  const left = bounds(notes, index),
    right = bounds(notes, index + 1);
  if (left[1] !== index || right[0] !== index + 1)
    throw new Error('这两个音符已在同一连梁组中');
  const group = notes.slice(left[0], right[1] + 1);
  check(group);
  for (const n of group) kids(n.element, 'beam').forEach((b) => b.remove());
  for (
    let level = 1;
    level <= Math.max(...group.map((n) => levels[n.type]));
    level++
  ) {
    for (const [i, n] of group.entries()) {
      if (levels[n.type] < level) continue;
      const before = i > 0 && levels[group[i - 1].type] >= level,
        after = i < group.length - 1 && levels[group[i + 1].type] >= level;
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
  return serialize(score);
}
export function clearBeam(xml: string, id: string) {
  const { score, notes, index } = roots(xml, id),
    [first, last] = bounds(notes, index),
    group = notes.slice(first, last + 1);
  check(group);
  for (const n of group) kids(n.element, 'beam').forEach((b) => b.remove());
  return serialize(score);
}
