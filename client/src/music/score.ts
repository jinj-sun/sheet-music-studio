/** MusicXML is the source of truth. Projections are never serialized back over it. */
export const NOTE_TYPES = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
  '128th': 0.03125,
} as const;
export type NoteType = keyof typeof NOTE_TYPES;
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const kids = (e: Element, name?: string): Element[] =>
  Array.from(e.children).filter((c) => !name || c.localName === name);
export const child = (e: Element, name: string) => kids(e, name)[0];
export const text = (e: Element, name: string, fallback = '') =>
  child(e, name)?.textContent?.trim() || fallback;
export const descendants = (e: Element | Document, name: string): Element[] =>
  Array.from(e.getElementsByTagNameNS('*', name));
const num = (e: Element, name: string, fallback = 0) =>
  Number(text(e, name, String(fallback)));
const EPS = 1e-7;

export interface ScoreNote {
  id: string;
  element: Element;
  partIndex: number;
  measureIndex: number;
  noteIndex: number;
  partId: string;
  voice: string;
  staff: number;
  onset: number;
  start: number;
  duration: number;
  divisions: number;
  type: string;
  dots: number;
  rest: boolean;
  chord: boolean;
  grace: boolean;
  cue: boolean;
  step: Step;
  alter: number;
  octave: number;
  midi: number | null;
  velocity: number;
  tieStart: boolean;
  tieStop: boolean;
}
export interface ScoreMeasure {
  id: string;
  element: Element;
  partIndex: number;
  index: number;
  number: string;
  start: number;
  duration: number;
  nominal: number;
  divisions: number;
  endCursor: number;
  midDivisions: boolean;
  staffCount: number;
  notes: ScoreNote[];
}
export interface ScorePart {
  id: string;
  name: string;
  program: number;
  measures: ScoreMeasure[];
}
export interface Tempo {
  beat: number;
  bpm: number;
}
export interface Score {
  xml: string;
  document: Document;
  title: string;
  parts: ScorePart[];
  notes: ScoreNote[];
  measures: ScoreMeasure[];
  duration: number;
  tempos: Tempo[];
  warnings: string[];
  playbackIssues: string[];
  readonly: boolean;
}

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label}必须大于 0`);
  return value;
}
export function parseScore(xml: string): Score {
  if (xml.length > 20_000_000)
    throw new Error('MusicXML 超过 20 MB，请拆分后导入');
  if (/<!ENTITY\s/i.test(xml))
    throw new Error('暂不支持包含自定义实体的 XML；原文件未修改');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (descendants(document, 'parsererror').length)
    throw new Error('MusicXML 语法错误，请检查标签是否闭合');
  const root = document.documentElement;
  if (!['score-partwise', 'score-timewise'].includes(root.localName))
    throw new Error('需要 score-partwise 或 score-timewise MusicXML 文件');
  const score: Score = {
    xml,
    document,
    title:
      descendants(root, 'work-title')[0]?.textContent ||
      descendants(root, 'movement-title')[0]?.textContent ||
      '未命名乐谱',
    parts: [],
    notes: [],
    measures: [],
    duration: 0,
    tempos: [],
    warnings: [],
    playbackIssues: [],
    readonly: root.localName === 'score-timewise',
  };
  if (score.readonly) {
    score.warnings.push(
      '这是 score-timewise 乐谱：保留完整源码，可导出和编辑 XML；图形编辑、播放与 MIDI 暂不可用。请在原制谱软件导出 partwise 格式。',
    );
    return score;
  }
  const localTempos: Array<{ measure: number; onset: number; bpm: number }> =
    [];
  const partNames = new Map(
    descendants(root, 'score-part').map((p) => [
      p.getAttribute('id'),
      text(p, 'part-name'),
    ]),
  );
  for (const [partIndex, pe] of kids(root, 'part').entries()) {
    const partId = pe.getAttribute('id') || `P${partIndex + 1}`;
    const definition = descendants(root, 'score-part').find(
      (p) => p.getAttribute('id') === partId,
    );
    const instrument = definition && child(definition, 'midi-instrument');
    const program = instrument ? num(instrument, 'midi-program', 1) : 1;
    const part: ScorePart = {
      id: partId,
      name: partNames.get(partId) || partId,
      program:
        Number.isInteger(program) && program >= 1 && program <= 128
          ? program - 1
          : 0,
      measures: [],
    };
    score.parts.push(part);
    let divisions = 1,
      nominal = 4,
      staffCount = 1,
      velocity = 80;
    const transpose = new Map<number, number>();
    for (const [index, me] of kids(pe, 'measure').entries()) {
      let cursor = 0,
        extent = 0,
        anchor: ScoreNote | undefined,
        noteIndex = 0,
        seenTimed = false;
      const measure: ScoreMeasure = {
        id: `p${partIndex}m${index}`,
        element: me,
        partIndex,
        index,
        number: me.getAttribute('number') || String(index + 1),
        start: 0,
        duration: 0,
        nominal,
        divisions,
        endCursor: 0,
        midDivisions: false,
        staffCount,
        notes: [],
      };
      part.measures.push(measure);
      score.measures.push(measure);
      for (const e of kids(me)) {
        if (e.localName === 'attributes') {
          if (child(e, 'divisions')) {
            const next = positive(num(e, 'divisions'), 'divisions');
            if (seenTimed && next !== divisions) measure.midDivisions = true;
            divisions = next;
          }
          const time = child(e, 'time');
          if (time && !child(time, 'senza-misura')) {
            const beatEls = kids(time, 'beats'),
              beatTypes = kids(time, 'beat-type');
            nominal = beatEls.reduce(
              (sum, b, i) =>
                sum +
                ((b.textContent || '4')
                  .split('+')
                  .reduce((s, n) => s + Number(n), 0) *
                  4) /
                  positive(Number(beatTypes[i]?.textContent || 4), '拍号分母'),
              0,
            );
            positive(nominal, '拍号');
          }
          if (child(e, 'staves'))
            staffCount = positive(num(e, 'staves'), '谱表数量');
          for (const t of kids(e, 'transpose'))
            transpose.set(
              Number(t.getAttribute('number') || 0),
              num(t, 'chromatic') + num(t, 'octave-change') * 12,
            );
          measure.nominal = nominal;
          measure.staffCount = staffCount;
        } else if (e.localName === 'backup' || e.localName === 'forward') {
          const duration = positive(num(e, 'duration'), '声部位移') / divisions;
          cursor += e.localName === 'backup' ? -duration : duration;
          if (cursor < -EPS)
            throw new Error(`第 ${measure.number} 小节 backup 超出小节起点`);
          cursor = Math.max(0, cursor);
          extent = Math.max(extent, cursor);
          anchor = undefined;
          seenTimed = true;
        } else if (e.localName === 'direction' || e.localName === 'sound') {
          const sound = e.localName === 'sound' ? e : child(e, 'sound');
          if (sound?.hasAttribute('dynamics')) {
            const dynamic = Number(sound.getAttribute('dynamics'));
            if (Number.isFinite(dynamic))
              velocity = Math.min(127, Math.max(1, dynamic * 0.9));
          }
          let bpm = Number(sound?.getAttribute('tempo') || 0);
          const metronome = descendants(e, 'metronome')[0];
          if (!bpm && metronome) {
            const unit =
              NOTE_TYPES[text(metronome, 'beat-unit') as NoteType] || 1;
            bpm =
              num(metronome, 'per-minute') *
              unit *
              (2 - 1 / 2 ** kids(metronome, 'beat-unit-dot').length);
          }
          if (bpm > 0)
            localTempos.push({
              measure: index,
              onset: cursor + num(e, 'offset') / divisions,
              bpm,
            });
        } else if (e.localName === 'note') {
          const grace = !!child(e, 'grace'),
            chord = !!child(e, 'chord'),
            rest = !!child(e, 'rest');
          const type = text(e, 'type', 'quarter'),
            dots = kids(e, 'dot').length;
          const tm = child(e, 'time-modification');
          const ratio = tm
            ? positive(num(tm, 'normal-notes'), '连音正常音符数') /
              positive(num(tm, 'actual-notes'), '连音音符数')
            : 1;
          const duration = grace
            ? 0
            : child(e, 'duration')
              ? positive(num(e, 'duration'), '音符时值') / divisions
              : (NOTE_TYPES[type as NoteType] || 1) *
                (2 - 1 / 2 ** dots) *
                ratio;
          if (!grace && !child(e, 'duration'))
            score.warnings.push(
              `第 ${measure.number} 小节有缺失 duration 的音符，试听按记谱时值推断；源码保持原样。`,
            );
          if (chord && (!anchor || anchor.grace !== grace))
            throw new Error(`第 ${measure.number} 小节存在没有主音的 chord`);
          const pitch = child(e, 'pitch'),
            step = (pitch ? text(pitch, 'step') : 'C') as Step;
          if (pitch && !STEPS.includes(step))
            throw new Error('音名必须是 C、D、E、F、G、A 或 B');
          const alter = pitch ? num(pitch, 'alter') : 0,
            octave = pitch ? num(pitch, 'octave', 4) : 4;
          if (!Number.isFinite(alter) || !Number.isInteger(octave))
            throw new Error('音高数据无效');
          const staff = num(e, 'staff', 1),
            voice = text(e, 'voice', '1');
          const n: ScoreNote = {
            id: `p${partIndex}m${index}n${noteIndex}`,
            element: e,
            partIndex,
            measureIndex: index,
            noteIndex: noteIndex++,
            partId,
            voice,
            staff,
            onset: chord ? anchor!.onset : cursor,
            start: 0,
            duration,
            divisions,
            type,
            dots,
            rest,
            chord,
            grace,
            cue: !!child(e, 'cue'),
            step,
            alter,
            octave,
            midi: pitch
              ? (octave + 1) * 12 +
                SEMITONES[step] +
                alter +
                (transpose.get(staff) ?? transpose.get(0) ?? 0)
              : null,
            velocity,
            tieStart: kids(e, 'tie').some(
              (t) => t.getAttribute('type') === 'start',
            ),
            tieStop: kids(e, 'tie').some(
              (t) => t.getAttribute('type') === 'stop',
            ),
          };
          if (
            chord &&
            (voice !== anchor!.voice || duration > anchor!.duration + EPS)
          )
            throw new Error(`第 ${measure.number} 小节和弦声部或时值不合法`);
          measure.notes.push(n);
          score.notes.push(n);
          staffCount = Math.max(staffCount, staff);
          measure.staffCount = staffCount;
          if (!chord) {
            anchor = n;
            cursor += duration;
          }
          extent = Math.max(extent, n.onset + duration);
          seenTimed = true;
        }
      }
      measure.endCursor = cursor;
      measure.divisions = divisions;
      measure.duration =
        me.getAttribute('implicit') === 'yes'
          ? extent
          : Math.max(extent, nominal);
      if (extent > nominal + EPS)
        score.warnings.push(
          `第 ${measure.number} 小节时长超过拍号，请检查声部和休止。`,
        );
    }
  }
  if (!score.parts.length) throw new Error('MusicXML 中未找到 part');
  const lengths: number[] = [];
  for (const m of score.measures)
    lengths[m.index] = Math.max(lengths[m.index] || 0, m.duration);
  const starts: number[] = [];
  let end = 0;
  for (let i = 0; i < lengths.length; i++) {
    starts[i] = end;
    end += lengths[i];
  }
  score.duration = end;
  for (const m of score.measures) {
    m.start = starts[m.index];
    for (const n of m.notes) n.start = m.start + n.onset;
  }
  const tempos = new Map<number, number>([[0, 120]]);
  for (const t of localTempos)
    tempos.set(Math.max(0, (starts[t.measure] || 0) + t.onset), t.bpm);
  score.tempos = [...tempos]
    .map(([beat, bpm]) => ({ beat, bpm }))
    .sort((a, b) => a.beat - b.beat);
  const has = (tag: string) => descendants(root, tag).length > 0;
  if (descendants(root, 'direction').some((d) => !child(d, 'direction-type')))
    score.warnings.push(
      '有 direction 缺少 direction-type：渲染时补充空占位，原始 XML 完整保留。',
    );
  if (
    has('repeat') ||
    has('ending') ||
    descendants(root, 'sound').some((s) =>
      ['dacapo', 'dalsegno', 'tocoda', 'fine'].some((a) => s.hasAttribute(a)),
    )
  )
    score.playbackIssues.push(
      '反复、房子和跳转尚未展开，试听/MIDI 按书写顺序演奏',
    );
  if (has('grace'))
    score.playbackIssues.push('倚音保留在谱面中，试听/MIDI 暂不发声');
  if (has('cue'))
    score.playbackIssues.push('提示小音符保留在谱面中，试听/MIDI 不发声');
  if (has('unpitched'))
    score.playbackIssues.push('无固定音高的打击乐暂不参与试听/MIDI');
  if (
    score.notes.some(
      (n) =>
        n.midi !== null &&
        (!Number.isInteger(n.midi) || n.midi < 0 || n.midi > 127),
    )
  )
    score.playbackIssues.push('微分音或超出 MIDI 范围的音符暂不参与试听/MIDI');
  if (has('pedal') || has('ornaments') || has('fermata'))
    score.playbackIssues.push(
      '踏板、装饰音与延长记号保留在谱面中，试听/MIDI 暂不解释',
    );
  if (
    has('octave-shift') ||
    descendants(root, 'transpose').some((t) => child(t, 'double'))
  )
    score.playbackIssues.push(
      '八度线或八度加倍保留在谱面中，试听/MIDI 暂不解释',
    );
  if (
    has('articulations') ||
    has('wedge') ||
    has('arpeggiate') ||
    has('tremolo') ||
    has('glissando')
  )
    score.playbackIssues.push(
      '奏法、渐强渐弱、琶音、震音与滑音保留在谱面中，试听/MIDI 暂按基本音高时值演奏',
    );
  if (
    descendants(root, 'score-part').some(
      (p) => kids(p, 'midi-instrument').length > 1,
    )
  )
    score.playbackIssues.push(
      '同一乐器中的音色切换暂不解释，MIDI 使用该乐器首个音色',
    );
  if (
    score.notes.some(
      (n) =>
        descendants(n.element, 'tied').length && !kids(n.element, 'tie').length,
    )
  )
    score.playbackIssues.push(
      '有仅含视觉 tied 标记的连线，缺少声音 tie，试听/MIDI 按独立音符演奏',
    );
  score.warnings = [...new Set(score.warnings)];
  return score;
}

const NOTE_ORDER = [
  'grace',
  'cue',
  'chord',
  'pitch',
  'unpitched',
  'rest',
  'duration',
  'tie',
  'instrument',
  'footnote',
  'level',
  'voice',
  'type',
  'dot',
  'accidental',
  'time-modification',
  'stem',
  'notehead',
  'notehead-text',
  'staff',
  'beam',
  'notations',
  'lyric',
  'play',
  'listen',
];
export function make(parent: Element, tag: string, value?: string): Element {
  const e = parent.ownerDocument.createElementNS(parent.namespaceURI, tag);
  if (value !== undefined) e.textContent = value;
  return e;
}
export function put(parent: Element, tag: string, value?: string): Element {
  let e = child(parent, tag);
  if (!e) {
    e = make(parent, tag);
    const rank = NOTE_ORDER.indexOf(tag);
    const before =
      parent.localName === 'note'
        ? kids(parent).find((c) => NOTE_ORDER.indexOf(c.localName) > rank)
        : undefined;
    parent.insertBefore(e, before || null);
  }
  if (value !== undefined) e.textContent = value;
  return e;
}
export function serialize(score: Score): string {
  const body = new XMLSerializer().serializeToString(score.document);
  const declaration = score.xml.match(/^\s*(<\?xml[^?]*\?>)/)?.[1];
  return declaration && !body.startsWith('<?xml')
    ? `${declaration}\n${body}`
    : body;
}
export const noteLabel = (n: ScoreNote) =>
  n.rest
    ? '休止'
    : `${n.step}${n.alter === 1 ? '♯' : n.alter === -1 ? '♭' : n.alter === 2 ? '𝄪' : n.alter === -2 ? '𝄫' : n.alter ? `(${n.alter})` : ''}${n.octave}`;
