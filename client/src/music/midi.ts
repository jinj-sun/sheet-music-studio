import { type Timeline, buildTimeline } from './timeline';
const PPQ = 9600;
const bytes = (value: number, count: number) =>
  Array.from(
    { length: count },
    (_, i) => (value >>> ((count - i - 1) * 8)) & 255,
  );
function vlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff)
    throw new Error('MIDI 时间超出格式范围');
  const result = [value & 127];
  while ((value >>>= 7)) result.unshift((value & 127) | 128);
  return result;
}
type Event = { tick: number; order: number; data: number[] };
function track(events: Event[], end: number) {
  events.push({ tick: end, order: 9, data: [255, 47, 0] });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  return [77, 84, 114, 107, ...bytes(data.length, 4), ...data];
}
function nameEvent(name: string): Event {
  const utf8 = [...new TextEncoder().encode(name)];
  return { tick: 0, order: 0, data: [255, 3, ...vlq(utf8.length), ...utf8] };
}
export function createMidi(
  input: Timeline | string,
  allowApproximate = false,
  speed = 1,
): Uint8Array {
  const timeline = typeof input === 'string' ? buildTimeline(input) : input;
  if (timeline.issues.length && !allowApproximate)
    throw new Error(`请先确认近似演奏：${timeline.issues.join('；')}`);
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('MIDI 速度无效');
  const groups = new Map<string, typeof timeline.notes>();
  for (const note of timeline.notes) {
    const key = `${note.partId} / 谱表${note.staff} / 声部${note.voice}`;
    groups.set(key, [...(groups.get(key) || []), note]);
  }
  if (groups.size > 15)
    throw new Error(
      '乐谱超过 15 个独立声部通道，暂不支持安全导出 MIDI；请使用 MusicXML',
    );
  const end = Math.round(timeline.duration * PPQ);
  const tempo: Event[] = [nameEvent('Tempo')];
  for (const t of timeline.tempos) {
    const micros = Math.round(60_000_000 / (t.bpm * speed));
    if (micros < 1 || micros > 0xffffff)
      throw new Error('速度超出 MIDI 可表示范围');
    tempo.push({
      tick: Math.round(t.beat * PPQ),
      order: 0,
      data: [255, 81, 3, ...bytes(micros, 3)],
    });
  }
  const chunks = [track(tempo, end)];
  let index = 0;
  for (const [name, notes] of groups) {
    const channel = index >= 9 ? index + 1 : index;
    index++;
    const events: Event[] = [
      nameEvent(name),
      {
        tick: 0,
        order: 0,
        data: [192 | channel, timeline.programs?.[notes[0].partId] || 0],
      },
    ];
    for (const n of notes) {
      events.push({
        tick: Math.round(n.start * PPQ),
        order: 2,
        data: [
          144 | channel,
          n.pitch,
          Math.max(1, Math.min(127, Math.round(n.velocity))),
        ],
      });
      events.push({
        tick: Math.round((n.start + n.duration) * PPQ),
        order: 1,
        data: [128 | channel, n.pitch, 0],
      });
    }
    chunks.push(track(events, end));
  }
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    1,
    ...bytes(chunks.length, 2),
    ...bytes(PPQ, 2),
    ...chunks.flat(),
  ]);
}
