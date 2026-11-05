import { type Score, type Tempo, parseScore } from './score';
export interface SoundingNote {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  partId: string;
  voice: string;
  staff: number;
  velocity: number;
}
export interface Timeline {
  notes: SoundingNote[];
  duration: number;
  tempos: Tempo[];
  issues: string[];
  programs?: Record<string, number>;
}
export function buildTimeline(input: Score | string): Timeline {
  const score = typeof input === 'string' ? parseScore(input) : input;
  if (score.readonly)
    throw new Error('score-timewise 暂不支持播放或 MIDI；XML 已完整保留');
  const notes: SoundingNote[] = [],
    active = new Map<string, SoundingNote>();
  const issues = [...score.playbackIssues];
  for (const n of [...score.notes].sort(
    (a, b) =>
      a.start - b.start ||
      a.partIndex - b.partIndex ||
      a.noteIndex - b.noteIndex,
  )) {
    if (
      n.rest ||
      n.grace ||
      n.cue ||
      n.midi === null ||
      !Number.isInteger(n.midi) ||
      n.midi < 0 ||
      n.midi > 127
    )
      continue;
    const key = `${n.partId}/${n.voice}/${n.staff}/${n.midi}`;
    const previous = active.get(key);
    if (previous && !n.tieStop)
      issues.push('有未匹配的延音线起点，按已有音符时值演奏');
    let event: SoundingNote;
    if (
      n.tieStop &&
      previous &&
      Math.abs(previous.start + previous.duration - n.start) < 1e-7
    ) {
      previous.duration = n.start + n.duration - previous.start;
      event = previous;
    } else {
      if (n.tieStop) issues.push('有未匹配的延音线终点，按独立音符演奏');
      event = {
        id: n.id,
        pitch: n.midi,
        start: n.start,
        duration: n.duration,
        partId: n.partId,
        voice: n.voice,
        staff: n.staff,
        velocity: n.velocity,
      };
      notes.push(event);
    }
    if (n.tieStart) active.set(key, event);
    else active.delete(key);
  }
  if (active.size) issues.push('有未匹配的延音线起点，按已有音符时值演奏');
  return {
    notes,
    duration: score.duration,
    tempos: score.tempos,
    issues: [...new Set(issues)],
    programs: Object.fromEntries(score.parts.map((p) => [p.id, p.program])),
  };
}
/** All positions are quarter-note beats, independent of tempo and meter denominator. */
export function beatToSeconds(beat: number, tempos: Tempo[]): number {
  let result = 0,
    position = 0,
    bpm = tempos[0]?.bpm || 120;
  for (const t of tempos) {
    if (t.beat > beat) break;
    result += ((t.beat - position) * 60) / bpm;
    position = t.beat;
    bpm = t.bpm;
  }
  return result + (Math.max(0, beat - position) * 60) / bpm;
}
export function secondsToBeat(seconds: number, tempos: Tempo[]): number {
  let position = 0,
    bpm = tempos[0]?.bpm || 120,
    remaining = Math.max(0, seconds);
  for (const t of tempos) {
    const span = ((t.beat - position) * 60) / bpm;
    if (remaining < span) return position + (remaining * bpm) / 60;
    remaining -= span;
    position = t.beat;
    bpm = t.bpm;
  }
  return position + (remaining * bpm) / 60;
}
