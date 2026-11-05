import {
  NOTE_TYPES,
  type NoteType,
  type Score,
  type ScoreNote,
  type ScoreMeasure,
  type Step,
  STEPS,
  parseScore,
  serialize,
  child,
  kids,
  text,
  make,
  put,
} from './score';

export interface PitchInput {
  step: Step;
  alter: number;
  octave: number;
}
export interface InsertInput extends PitchInput {
  partIndex: number;
  measureIndex: number;
  staff: number;
  voice: string;
  onset: number;
  type: NoteType;
  dots: number;
  rest: boolean;
}
export const durationOf = (type: NoteType, dots: number) =>
  NOTE_TYPES[type] * (2 - 1 / 2 ** dots);
const EPS = 1e-7;
function transaction(xml: string, action: (score: Score) => void) {
  const score = parseScore(xml);
  if (score.readonly)
    throw new Error('此格式仅支持 XML 源码编辑，原始信息已保留');
  action(score);
  const result = serialize(score);
  parseScore(result);
  return result;
}
function find(score: Score, id: string) {
  const n = score.notes.find((n) => n.id === id);
  if (!n) throw new Error('请先选择一个音符');
  return n;
}
function group(score: Score, n: ScoreNote): ScoreNote[] {
  const notes = score.parts[n.partIndex].measures[n.measureIndex].notes;
  let i = notes.indexOf(n);
  while (notes[i].chord) i--;
  const result = [notes[i]];
  while (notes[++i]?.chord) result.push(notes[i]);
  return result;
}
function guardStructure(m: ScoreMeasure) {
  if (m.midDivisions)
    throw new Error(
      '此小节中途改变 divisions，结构编辑已保护性停用；请使用 XML 源码编辑',
    );
  const firstTimed = kids(m.element).findIndex((e) =>
    ['note', 'forward', 'backup'].includes(e.localName),
  );
  if (
    kids(m.element).some(
      (e, i) =>
        e.localName === 'attributes' && firstTimed >= 0 && i > firstTimed,
    )
  )
    throw new Error('此小节含中途属性变更，请使用 XML 调整结构');
}
function pitch(n: ScoreNote, value: PitchInput) {
  if (
    !STEPS.includes(value.step) ||
    !Number.isInteger(value.octave) ||
    value.octave < 0 ||
    value.octave > 9 ||
    !Number.isInteger(value.alter) ||
    Math.abs(value.alter) > 2
  )
    throw new Error('请输入有效音高（八度 0–9，变化音 -2–2）');
  if (n.tieStart || n.tieStop)
    throw new Error('请先解除此音符的延音线，再修改音高');
  if (child(n.element, 'unpitched'))
    throw new Error('打击乐音符需在 XML 中编辑，避免丢失音头信息');
  child(n.element, 'rest')?.remove();
  const p = put(n.element, 'pitch');
  const step = child(p, 'step') || make(p, 'step');
  step.textContent = value.step;
  p.insertBefore(step, p.firstChild);
  const octave = child(p, 'octave') || make(p, 'octave');
  octave.textContent = String(value.octave);
  p.appendChild(octave);
  const alter = child(p, 'alter');
  if (value.alter) {
    const a = alter || make(p, 'alter');
    a.textContent = String(value.alter);
    p.insertBefore(a, octave);
  } else alter?.remove();
  if (value.alter || child(n.element, 'accidental'))
    put(
      n.element,
      'accidental',
      (
        {
          '-2': 'flat-flat',
          '-1': 'flat',
          0: 'natural',
          1: 'sharp',
          2: 'double-sharp',
        } as Record<number, string>
      )[value.alter],
    );
}
export function changePitch(xml: string, id: string, value: PitchInput) {
  return transaction(xml, (s) => pitch(find(s, id), value));
}
export function makeRest(xml: string, id: string) {
  return transaction(xml, (s) => {
    const n = find(s, id);
    if (child(n.element, 'unpitched'))
      throw new Error('打击乐音符需在 XML 中转换，避免丢失音头和乐器信息');
    if (group(s, n).length > 1)
      throw new Error('请先删除多余和弦音，再把单音改为休止符');
    if (
      n.tieStart ||
      n.tieStop ||
      child(n.element, 'notations')?.getElementsByTagName('slur').length
    )
      throw new Error('请先解除连线，再改为休止符');
    child(n.element, 'pitch')?.remove();
    child(n.element, 'accidental')?.remove();
    put(n.element, 'rest');
  });
}
function units(quarters: number, divisions: number) {
  const value = quarters * divisions;
  if (
    !Number.isInteger(Math.round(value)) ||
    Math.abs(value - Math.round(value)) > EPS ||
    value <= 0
  )
    throw new Error(
      '当前 divisions 无法精确表示此时值，请在 XML 中提高 divisions 后重试',
    );
  return String(Math.round(value));
}
function movement(
  parent: Element,
  tag: 'forward' | 'backup',
  quarters: number,
  divisions: number,
) {
  const e = make(parent, tag);
  e.appendChild(make(parent, 'duration', units(quarters, divisions)));
  return e;
}
function notationDuration(n: ScoreNote, type: NoteType, dots: number) {
  put(n.element, 'type', type);
  kids(n.element, 'dot').forEach((e) => e.remove());
  for (let i = 0; i < dots; i++) {
    const d = make(n.element, 'dot');
    const typeEl = child(n.element, 'type')!;
    n.element.insertBefore(d, typeEl.nextSibling);
  }
  child(n.element, 'rest')?.removeAttribute('measure');
}
export function changeRhythm(
  xml: string,
  id: string,
  type: NoteType,
  dots: number,
  ripple = false,
) {
  return transaction(xml, (s) => {
    if (
      !(type in NOTE_TYPES) ||
      !Number.isInteger(dots) ||
      dots < 0 ||
      dots > 2
    )
      throw new Error('时值或附点无效');
    const n = find(s, id),
      g = group(s, n),
      root = g[0];
    const m = s.parts[n.partIndex].measures[n.measureIndex];
    guardStructure(m);
    if (g.some((n) => n.grace || n.tieStart || n.tieStop))
      throw new Error('倚音或延音线中的时值请在 XML 中修改，或先解除延音线');
    if (g.some((n) => kids(n.element, 'beam').length))
      throw new Error(
        '此音符有显式连梁；请在 XML 中同步调整 beam，避免破坏手工分组',
      );
    const durations = g.map((note) => {
      const tm = child(note.element, 'time-modification');
      const ratio = tm
        ? Number(text(tm, 'normal-notes')) / Number(text(tm, 'actual-notes'))
        : 1;
      return durationOf(type, dots) * ratio;
    });
    if (durations.some((d) => Math.abs(d - durations[0]) > EPS))
      throw new Error('此和弦有不同连音比例，需在 XML 中编辑');
    const duration = durations[0];
    const next = m.notes
      .filter(
        (x) =>
          !g.includes(x) &&
          x.voice === root.voice &&
          x.staff === root.staff &&
          x.onset >= root.onset + root.duration - EPS,
      )
      .sort((a, b) => a.onset - b.onset)[0];
    const limit = ripple
      ? Math.max(m.nominal, m.duration)
      : (next?.onset ?? m.duration);
    if (root.onset + duration > limit + EPS)
      throw new Error(
        '新时值会覆盖同声部的下一音符或超出小节；请先缩短/删除后续音符',
      );
    for (const note of g) {
      put(note.element, 'duration', units(duration, note.divisions));
      notationDuration(note, type, dots);
    }
    const delta = duration - root.duration;
    if (ripple && Math.abs(delta) > EPS) {
      rippleVoice(m, root, g, duration, delta);
      return;
    }
    if (Math.abs(delta) > EPS)
      m.element.insertBefore(
        movement(
          m.element,
          delta > 0 ? 'backup' : 'forward',
          Math.abs(delta),
          root.divisions,
        ),
        g.at(-1)!.element.nextSibling,
      );
  });
}

/** Retime only this staff/voice inside the measure; keep all musical nodes in place. */
function rippleVoice(
  m: ScoreMeasure,
  root: ScoreNote,
  changed: ScoreNote[],
  duration: number,
  delta: number,
) {
  const affected = m.notes.filter(
    (n) =>
      n.staff === root.staff &&
      n.voice === root.voice &&
      !changed.includes(n) &&
      n.onset >= root.onset + root.duration - EPS,
  );
  if (
    affected.some(
      (n) =>
        n.grace || n.tieStart || n.tieStop || kids(n.element, 'beam').length,
    )
  )
    throw new Error(
      '顺移涉及倚音、延音线或手工连梁，请先解除连线/连梁，或使用 XML 编辑',
    );
  const starts = new Map(
    m.notes.map((n) => [
      n.element,
      n.onset + (affected.includes(n) ? delta : 0),
    ]),
  );
  if (
    m.notes.some(
      (n) =>
        starts.get(n.element)! < -EPS ||
        starts.get(n.element)! + (changed.includes(n) ? duration : n.duration) >
          Math.max(m.nominal, m.duration) + EPS,
    )
  )
    throw new Error('顺移会使音符超出小节；请先缩短后续音符');
  const elements = kids(m.element),
    notes = new Map(m.notes.map((n) => [n.element, n]));
  const lastNote = elements.map((e) => e.localName).lastIndexOf('note');
  if (
    elements
      .slice(lastNote + 1)
      .some((e) => ['backup', 'forward'].includes(e.localName))
  )
    throw new Error('小节尾部有独立时间占位，请使用 XML 编辑以保留其含义');
  const positions = new Map<Element, number>();
  let oldCursor = 0;
  // Only bare cursor movements can be rewritten. Extensions/IDs on them must survive.
  for (const e of elements) {
    positions.set(e, oldCursor);
    if (['backup', 'forward'].includes(e.localName)) {
      if (
        e.attributes.length ||
        kids(e).some((c) => c.localName !== 'duration') ||
        child(e, 'duration')?.attributes.length ||
        Array.from(e.childNodes).some((c) => c.nodeType === 8)
      )
        throw new Error(
          '此小节的时间移动包含扩展或声部标记，请使用 XML 编辑以保留全部信息',
        );
      oldCursor +=
        ((e.localName === 'backup' ? -1 : 1) * Number(text(e, 'duration'))) /
        m.divisions;
    } else {
      const n = notes.get(e);
      if (n && !n.chord) oldCursor = n.onset + n.duration;
    }
  }
  let cursor = 0;
  for (const e of elements) {
    if (['backup', 'forward'].includes(e.localName)) {
      e.remove();
      continue;
    }
    const n = notes.get(e);
    // Directions, harmony and extension nodes retain their original time anchor.
    const anchor = n
      ? n.chord
        ? undefined
        : starts.get(e)
      : ['attributes', 'print', 'barline'].includes(e.localName)
        ? undefined
        : positions.get(e);
    if (anchor !== undefined && Math.abs(anchor - cursor) > EPS) {
      m.element.insertBefore(
        movement(
          m.element,
          anchor < cursor ? 'backup' : 'forward',
          Math.abs(anchor - cursor),
          m.divisions,
        ),
        e,
      );
      cursor = anchor;
    }
    if (n && !n.chord) cursor += changed.includes(n) ? duration : n.duration;
  }
}
function buildNote(parent: Element, input: InsertInput, divisions: number) {
  if (
    !(input.type in NOTE_TYPES) ||
    !Number.isInteger(input.dots) ||
    input.dots < 0 ||
    input.dots > 2
  )
    throw new Error('插入时值无效');
  if (
    !input.voice.trim() ||
    input.voice.length > 24 ||
    !Number.isInteger(input.staff) ||
    input.staff < 1
  )
    throw new Error('声部或谱表无效');
  const e = make(parent, 'note');
  if (input.rest) put(e, 'rest');
  else
    pitch({ element: e, tieStart: false, tieStop: false } as ScoreNote, input);
  put(e, 'duration', units(durationOf(input.type, input.dots), divisions));
  put(e, 'voice', input.voice.trim());
  put(e, 'type', input.type);
  for (let i = 0; i < input.dots; i++)
    e.insertBefore(make(e, 'dot'), child(e, 'type')!.nextSibling);
  put(e, 'staff', String(input.staff));
  return e;
}
export function insertNote(xml: string, input: InsertInput) {
  return transaction(xml, (s) => {
    const m = s.parts[input.partIndex]?.measures[input.measureIndex];
    if (!m) throw new Error('请选择有效小节');
    guardStructure(m);
    if (input.staff > m.staffCount) throw new Error('此小节不存在该谱表');
    const end = input.onset + durationOf(input.type, input.dots);
    if (
      !Number.isFinite(input.onset) ||
      input.onset < 0 ||
      end > m.duration + EPS
    )
      throw new Error('插入位置必须在小节内（以四分音符为 1 拍，从 0 起）');
    if (
      m.notes.some(
        (n) =>
          n.staff === input.staff &&
          n.voice === input.voice &&
          n.onset < end - EPS &&
          n.onset + n.duration > input.onset + EPS,
      )
    )
      throw new Error(
        '该声部此位置已有音符；可替换休止符、选择其他声部或添加和弦音',
      );
    // Add a separate voice segment, leaving all existing MusicXML children untouched.
    const before =
      kids(m.element, 'barline').find(
        (b) => b.getAttribute('location') !== 'left',
      ) || null;
    if (m.endCursor > EPS)
      m.element.insertBefore(
        movement(m.element, 'backup', m.endCursor, m.divisions),
        before,
      );
    if (input.onset > EPS)
      m.element.insertBefore(
        movement(m.element, 'forward', input.onset, m.divisions),
        before,
      );
    m.element.insertBefore(buildNote(m.element, input, m.divisions), before);
  });
}
export function addChordTone(xml: string, id: string, value: PitchInput) {
  return transaction(xml, (s) => {
    const n = find(s, id),
      g = group(s, n),
      root = g[0];
    if (root.rest || root.grace || root.midi === null)
      throw new Error(
        '和弦需要普通的固定音高音符，不能从休止符、倚音或打击乐音符添加',
      );
    if (
      g.some(
        (x) =>
          x.step === value.step &&
          x.alter === value.alter &&
          x.octave === value.octave,
      )
    )
      throw new Error('和弦中已经有这个音');
    const e = make(root.element, 'note');
    pitch({ element: e, tieStart: false, tieStop: false } as ScoreNote, value);
    put(e, 'chord');
    // Copy only intentional musical fields. Do not clone lyrics, IDs or foreign extensions.
    for (const tag of [
      'duration',
      'voice',
      'type',
      'dot',
      'time-modification',
      'staff',
    ])
      for (const c of kids(root.element, tag)) {
        const rank = [
          'chord',
          'pitch',
          'duration',
          'voice',
          'type',
          'dot',
          'accidental',
          'time-modification',
          'staff',
        ];
        const before = kids(e).find(
          (x) => rank.indexOf(x.localName) > rank.indexOf(tag),
        );
        e.insertBefore(c.cloneNode(true), before || null);
      }
    const m = root.element.parentElement!;
    m.insertBefore(e, g.at(-1)!.element.nextSibling);
  });
}
export function deleteNote(xml: string, id: string) {
  return transaction(xml, (s) => {
    const n = find(s, id),
      g = group(s, n);
    if (
      n.grace ||
      n.tieStart ||
      n.tieStop ||
      kids(n.element, 'notations').some((e) => e.children.length) ||
      kids(n.element, 'lyric').length ||
      kids(n.element).some(
        (e) =>
          ![
            'pitch',
            'rest',
            'duration',
            'voice',
            'type',
            'dot',
            'accidental',
            'staff',
            'stem',
            'chord',
            'beam',
          ].includes(e.localName),
      )
    )
      throw new Error(
        '此音符含连线、连音、歌词或扩展信息，请在 XML 中明确处理后删除',
      );
    if (g.length > 1) {
      if (!n.chord) {
        if (Math.abs(g[1].duration - n.duration) > EPS)
          throw new Error('和弦音时值不一致，请先在 XML 中处理');
        child(g[1].element, 'chord')?.remove();
      }
      n.element.remove();
    } else {
      child(n.element, 'pitch')?.remove();
      child(n.element, 'accidental')?.remove();
      put(n.element, 'rest');
    }
  });
}
function tieTag(n: ScoreNote, type: 'start' | 'stop', remove: boolean) {
  const notations = child(n.element, 'notations');
  for (const e of kids(n.element, 'tie').filter(
    (e) => e.getAttribute('type') === type,
  ))
    e.remove();
  if (notations)
    for (const e of kids(notations, 'tied').filter(
      (e) => e.getAttribute('type') === type,
    ))
      e.remove();
  if (!remove) {
    const tie = make(n.element, 'tie');
    tie.setAttribute('type', type);
    n.element.insertBefore(
      tie,
      kids(n.element).find((e) =>
        ['instrument', 'voice', 'type', 'staff', 'notations'].includes(
          e.localName,
        ),
      ) || null,
    );
    const tied = make(n.element, 'tied');
    tied.setAttribute('type', type);
    put(n.element, 'notations').appendChild(tied);
  }
}
function following(score: Score, n: ScoreNote, samePitch: boolean) {
  return score.notes
    .filter(
      (x) =>
        x.partId === n.partId &&
        x.voice === n.voice &&
        x.staff === n.staff &&
        !x.rest &&
        !x.grace &&
        x.start > n.start + EPS &&
        (!samePitch || x.midi === n.midi),
    )
    .sort((a, b) => a.start - b.start)[0];
}
export function toggleTie(xml: string, id: string) {
  return transaction(xml, (s) => {
    const n = find(s, id);
    if (n.rest || n.grace) throw new Error('延音线需要普通音符');
    if (n.tieStart || n.tieStop) {
      if (n.tieStart) {
        const next = following(s, n, true);
        if (next?.tieStop) tieTag(next, 'stop', true);
        tieTag(n, 'start', true);
      }
      if (n.tieStop) {
        const previous = s.notes
          .filter(
            (x) =>
              x.partId === n.partId &&
              x.voice === n.voice &&
              x.staff === n.staff &&
              x.midi === n.midi &&
              x.tieStart &&
              x.start < n.start,
          )
          .sort((a, b) => b.start - a.start)[0];
        if (previous) tieTag(previous, 'start', true);
        tieTag(n, 'stop', true);
      }
      return;
    }
    const next = following(s, n, true);
    if (!next || Math.abs(next.start - (n.start + n.duration)) > EPS)
      throw new Error('延音线需要同声部、相同音高、时间相邻的下一音符');
    tieTag(n, 'start', false);
    tieTag(next, 'stop', false);
  });
}
export function toggleSlur(xml: string, firstId: string, lastId: string) {
  return transaction(xml, (s) => {
    const a = find(s, firstId),
      b = find(s, lastId);
    if (
      a.partId !== b.partId ||
      a.voice !== b.voice ||
      b.start <= a.start ||
      a.rest ||
      b.rest
    )
      throw new Error('连奏线需要同声部、按时间先后的两个音符');
    const existing = kids(
      child(a.element, 'notations') || a.element,
      'slur',
    ).find((e) => e.getAttribute('type') === 'start');
    if (existing) {
      const number = existing.getAttribute('number') || '1';
      const end = kids(child(b.element, 'notations') || b.element, 'slur').find(
        (e) =>
          e.getAttribute('type') === 'stop' &&
          (e.getAttribute('number') || '1') === number,
      );
      if (!end) throw new Error('所选终点与现有连奏线不匹配，请选择原终点');
      existing.remove();
      end.remove();
      return;
    }
    const used = new Set(
      Array.from(s.document.getElementsByTagName('slur')).map(
        (e) => e.getAttribute('number') || '1',
      ),
    );
    const number = [1, 2, 3, 4, 5, 6].find((v) => !used.has(String(v)));
    if (!number) throw new Error('连奏线编号已满，请使用 XML 编辑');
    for (const [n, type] of [
      [a, 'start'],
      [b, 'stop'],
    ] as const) {
      const e = make(n.element, 'slur');
      e.setAttribute('type', type);
      e.setAttribute('number', String(number));
      put(n.element, 'notations').appendChild(e);
    }
  });
}
export function appendMeasure(xml: string) {
  return transaction(xml, (s) => {
    for (const part of s.parts) {
      const last = part.measures.at(-1);
      if (!last) continue;
      const pe = last.element.parentElement!,
        m = make(pe, 'measure');
      m.setAttribute('number', String(part.measures.length + 1));
      for (let staff = 1; staff <= last.staffCount; staff++) {
        if (staff > 1)
          m.appendChild(movement(m, 'backup', last.nominal, last.divisions));
        const e = make(m, 'note');
        put(e, 'rest').setAttribute('measure', 'yes');
        put(e, 'duration', units(last.nominal, last.divisions));
        put(e, 'voice', String(staff));
        put(e, 'staff', String(staff));
        m.appendChild(e);
      }
      pe.appendChild(m);
    }
  });
}
export function createPianoScore(title = '未命名钢琴曲') {
  const safe = title.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
  const rests = (staff: number) =>
    Array.from(
      { length: 4 },
      () =>
        `<note><rest/><duration>480</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`,
    ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${safe}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>${rests(1)}<backup><duration>1920</duration></backup>${rests(2)}</measure></part></score-partwise>`;
}
