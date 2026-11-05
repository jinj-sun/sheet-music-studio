import {
  kids,
  make,
  parseScore,
  put,
  serialize,
  type Score,
  type ScoreNote,
} from './score';
import { buildTimeline } from './timeline';

export type Finger = 1 | 2 | 3 | 4 | 5;
export interface FingerEdit {
  id: string;
  finger: Finger | null;
}
export interface FingerSuggestion {
  id: string;
  finger: Finger;
}
const FINGERS: Finger[] = [1, 2, 3, 4, 5];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const SPACING = [0, 0, 2, 4, 5, 7];
const EPS = 1e-7;

function markers(n: ScoreNote) {
  return kids(n.element, 'notations').flatMap((e) =>
    kids(e, 'technical').flatMap((t) => kids(t, 'fingering')),
  );
}
export function readFingering(n?: ScoreNote): {
  finger?: Finger;
  complex: boolean;
} {
  if (!n) return { complex: false };
  const list = markers(n);
  if (!list.length) return { complex: false };
  const mark = list[0],
    number = Number(mark.textContent);
  if (
    list.length !== 1 ||
    !FINGERS.includes(number as Finger) ||
    mark.getAttribute('alternate') === 'yes' ||
    mark.getAttribute('substitution') === 'yes' ||
    Array.from(mark.childNodes).some(
      (node) => node.nodeType !== 3 && node.nodeType !== 4,
    )
  )
    return { complex: true };
  return { finger: number as Finger, complex: false };
}
export function applyFingerings(
  xml: string,
  edits: FingerEdit[],
  preserveExisting = false,
) {
  const score = parseScore(xml),
    byId = new Map(score.notes.map((n) => [n.id, n]));
  if (score.readonly) throw new Error('此谱暂不支持图形指法编辑');
  for (const edit of edits) {
    const n = byId.get(edit.id);
    if (!n || n.rest || n.midi === null)
      throw new Error('请在有音高的音符上添加钢琴指法');
    const old = readFingering(n);
    if (preserveExisting && (old.finger || old.complex)) continue;
    if (old.complex)
      throw new Error('此音符有换指或多组指法，请在 XML 中编辑以保留完整信息');
    const current = markers(n)[0];
    if (edit.finger === null) {
      current?.remove();
      continue;
    }
    if (!FINGERS.includes(edit.finger)) throw new Error('钢琴指法必须为 1–5');
    if (current) current.textContent = String(edit.finger);
    else {
      const technical = put(put(n.element, 'notations'), 'technical');
      technical.appendChild(make(technical, 'fingering', String(edit.finger)));
    }
  }
  return serialize(score);
}

interface Key {
  pitch: number;
  finger: Finger;
  end: number;
}
interface FrameKey {
  pitch: number;
  end: number;
  note: ScoreNote;
  finger?: Finger;
  complex: boolean;
}
interface Frame {
  start: number;
  keys: FrameKey[];
}
interface Path {
  cost: number;
  held: Key[];
  last: Key[];
  beat: number;
  changes: FingerSuggestion[];
  previous?: Path;
}

function options(count: number, direction: number) {
  const result: Finger[][] = [];
  function walk(prefix: Finger[], from: number) {
    if (prefix.length === count) {
      result.push(direction === 1 ? prefix : [...prefix].reverse());
      return;
    }
    for (let i = from; i < 5; i++) walk([...prefix, FINGERS[i]], i + 1);
  }
  walk([], 0);
  return result;
}
function playable(keys: Key[], direction: number) {
  const sorted = [...keys].sort((a, b) => a.pitch - b.pitch);
  if (sorted.at(-1)!.pitch - sorted[0].pitch > 14) return false;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1],
      b = sorted[i];
    if (
      a.pitch === b.pitch
        ? a.finger !== b.finger
        : (b.finger - a.finger) * direction <= 0
    )
      return false;
  }
  return true;
}
function position(keys: Key[], dir: number) {
  return (
    keys.reduce((sum, k) => sum + dir * k.pitch - SPACING[k.finger], 0) /
    keys.length
  );
}
function movementCost(previous: Path, next: Key[], at: number, dir: number) {
  if (!previous.last.length) return 0;
  const gap = Math.max(0, at - previous.beat),
    fast = 1 / (0.5 + gap);
  let cost =
    Math.abs(position(next, dir) - position(previous.last, dir)) * 0.34 * fast;
  if (next.length === 1 && previous.last.length === 1) {
    const a = previous.last[0],
      b = next[0],
      delta = (b.pitch - a.pitch) * dir,
      df = b.finger - a.finger;
    if (!delta) cost += df ? 0.65 : 0;
    else if (!df) cost += Math.min(2.7, 0.75 + Math.abs(delta) * 0.35) * fast;
    else if (delta * df < 0) {
      const thumb = delta > 0 ? b : a;
      const crossing =
        thumb.finger === 1 &&
        !BLACK_KEYS.has(thumb.pitch % 12) &&
        Math.abs(delta) <= 3;
      cost += (crossing ? 0.35 : 1.9) * fast;
    }
  }
  return cost;
}

/** Local heuristic: fit hand shape, neighboring notes and still-held keys. Never applies changes. */
export function suggestFingerings(
  score: Score,
  scope?: { partIndex: number; measureIndex: number },
): { suggestions: FingerSuggestion[]; skipped: number } {
  const lookup = new Map(score.notes.map((n) => [n.id, n])),
    hands = new Map<
      string,
      { direction: number; frames: Map<number, Frame> }
    >();
  const pianoParts = new Set(
    score.parts.flatMap((p, i) =>
      p.program === 0 &&
      Math.max(...p.measures.map((m) => m.staffCount)) <= 2 &&
      (/piano|钢琴|鋼琴/i.test(p.name) ||
        p.measures.some((m) => m.staffCount === 2))
        ? [i]
        : [],
    ),
  );
  if (!pianoParts.size)
    throw new Error(
      '自动建议适用于双谱表钢琴或标为 Piano 的谱；也可以逐音手动添加指法',
    );
  const events = buildTimeline(score).notes.filter((e) => {
    const n = lookup.get(e.id)!;
    return (
      pianoParts.has(n.partIndex) &&
      n.staff <= 2 &&
      e.pitch >= 21 &&
      e.pitch <= 108 &&
      (!scope ||
        (n.partIndex === scope.partIndex &&
          n.measureIndex === scope.measureIndex))
    );
  });
  if (events.length > 8000) throw new Error('此谱较长，请分小节生成指法建议');
  for (const e of events) {
    const n = lookup.get(e.id)!,
      key = `${n.partIndex}/${n.staff}`,
      beat = Math.round(e.start * 1e7) / 1e7;
    if (!hands.has(key))
      hands.set(key, { direction: n.staff === 1 ? 1 : -1, frames: new Map() });
    const hand = hands.get(key)!;
    if (!hand.frames.has(beat))
      hand.frames.set(beat, { start: e.start, keys: [] });
    const frame = hand.frames.get(beat)!,
      current = frame.keys.find((k) => k.pitch === e.pitch),
      existing = readFingering(n);
    if (current) {
      current.end = Math.max(current.end, e.start + e.duration);
      current.complex ||=
        existing.complex ||
        !!(
          existing.finger &&
          current.finger &&
          existing.finger !== current.finger
        );
      current.finger ||= existing.finger;
    } else
      frame.keys.push({
        pitch: e.pitch,
        end: e.start + e.duration,
        note: n,
        ...existing,
      });
  }
  const suggestions: FingerSuggestion[] = [];
  let skipped = 0;
  for (const { direction, frames } of hands.values()) {
    let beam: Path[] = [{ cost: 0, held: [], last: [], beat: 0, changes: [] }],
      blockedUntil = -1;
    for (const frame of frames.values()) {
      const keys = frame.keys.sort((a, b) => a.pitch - b.pitch),
        next: Path[] = [];
      if (
        frame.start >= blockedUntil - EPS &&
        !keys.some((k) => k.complex) &&
        keys.length <= 5
      ) {
        for (const fingers of options(keys.length, direction)) {
          if (keys.some((k, i) => k.finger && k.finger !== fingers[i]))
            continue;
          const chord = keys.map((k, i) => ({
            pitch: k.pitch,
            finger: fingers[i],
            end: k.end,
          }));
          let comfort = 0;
          for (const [i, k] of chord.entries()) {
            if (BLACK_KEYS.has(k.pitch % 12))
              comfort += k.finger === 1 ? 1.35 : k.finger === 5 ? 0.45 : 0;
            if (i > 0)
              comfort +=
                Math.max(
                  0,
                  k.pitch -
                    chord[i - 1].pitch -
                    Math.abs(SPACING[k.finger] - SPACING[chord[i - 1].finger]) -
                    1,
                ) **
                  2 *
                0.14;
          }
          const changes = keys.flatMap((k, i) =>
            !k.finger ? [{ id: k.note.id, finger: fingers[i] }] : [],
          );
          for (const old of beam) {
            const held = [
              ...old.held.filter((k) => k.end > frame.start + EPS),
              ...chord,
            ];
            if (!playable(held, direction)) continue;
            next.push({
              cost:
                old.cost +
                comfort +
                movementCost(old, chord, frame.start, direction),
              held,
              last: chord,
              beat: frame.start,
              changes,
              previous: old,
            });
          }
        }
      }
      if (next.length) beam = next.sort((a, b) => a.cost - b.cost).slice(0, 12);
      else {
        skipped++;
        blockedUntil = Math.max(
          blockedUntil,
          ...keys.map((k) => k.end),
          ...beam[0].held.map((k) => k.end),
        );
        beam = [
          {
            cost: beam[0].cost,
            held: [],
            last: [],
            beat: frame.start,
            changes: [],
            previous: beam[0],
          },
        ];
      }
    }
    let path: Path | undefined = beam[0];
    const steps: FingerSuggestion[][] = [];
    while (path) {
      steps.push(path.changes);
      path = path.previous;
    }
    for (const step of steps.reverse()) suggestions.push(...step);
  }
  suggestions.sort(
    (a, b) =>
      lookup.get(a.id)!.start - lookup.get(b.id)!.start ||
      lookup.get(a.id)!.staff - lookup.get(b.id)!.staff,
  );
  return { suggestions, skipped };
}
