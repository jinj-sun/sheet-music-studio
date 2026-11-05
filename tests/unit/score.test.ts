import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseScore,
  child,
  kids,
  descendants,
  type ScoreNote,
} from '../../client/src/music/score';
import {
  changePitch,
  changeRhythm,
  insertNote,
  addChordTone,
  deleteNote,
  toggleTie,
  toggleSlur,
  createPianoScore,
  appendMeasure,
  makeRest,
} from '../../client/src/music/editor';
import {
  buildTimeline,
  beatToSeconds,
  secondsToBeat,
} from '../../client/src/music/timeline';
import {
  createHistory,
  pushHistory,
  undo,
  redo,
} from '../../client/src/music/history';
const xml = readFileSync('tests/fixtures/complex.musicxml', 'utf8');
const pitched = () =>
  changePitch(createPianoScore(), 'p0m0n0', { step: 'C', alter: 0, octave: 4 });
describe('MusicXML canonical document and timeline', () => {
  it('keeps the untouched XML byte-for-byte as text', () => {
    expect(parseScore(xml).xml).toBe(xml);
  });
  it('aligns chords, backups, forwards, grand staff and multiple parts', () => {
    const s = parseScore(xml);
    expect(s.duration).toBe(8);
    expect(s.notes.slice(0, 3).map((n) => n.start)).toEqual([0, 0, 0]);
    expect(s.notes.find((n) => n.voice === '2')!.start).toBe(0);
    expect(s.notes.find((n) => n.voice === '3')!.start).toBe(0);
    expect(s.parts[1].measures[0].start).toBe(0);
    expect(s.parts[0].measures[1].start).toBe(4);
  });
  it('uses duration/divisions for dotted notes and tuplets', () => {
    const s = parseScore(xml);
    expect(s.notes.find((n) => n.step === 'D' && !n.rest)!.duration).toBe(1.5);
    const triplets = s.notes.filter(
      (n) => n.measureIndex === 1 && child(n.element, 'time-modification'),
    );
    expect(triplets.map((n) => n.duration)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(triplets[1].start).toBeCloseTo(5 + 1 / 3);
    expect(triplets[1].midi).toBe(70);
  });
  it('merges sounding ties without retriggering', () => {
    const timeline = buildTimeline(xml);
    const tied = timeline.notes.find(
      (n) =>
        n.partId === 'P1' && n.voice === '1' && n.pitch === 60 && n.start === 3,
    )!;
    expect(tied.duration).toBe(2);
    expect(
      timeline.notes.some(
        (n) =>
          n.partId === 'P1' &&
          n.voice === '1' &&
          n.pitch === 60 &&
          n.start === 4,
      ),
    ).toBe(false);
  });
  it('handles tempo maps identically in both directions', () => {
    const t = parseScore(xml).tempos;
    expect(beatToSeconds(4, t)).toBe(2);
    expect(beatToSeconds(8, t)).toBe(6);
    for (const beat of [0, 1.5, 4, 5.333, 8])
      expect(secondsToBeat(beatToSeconds(beat, t), t)).toBeCloseTo(beat);
  });
  it('reports interpretation limits instead of discarding notation', () => {
    expect(buildTimeline(xml).issues.join()).toContain('踏板');
    const repeated = xml.replace(
      '<measure number="2">',
      '<measure number="2"><barline><repeat direction="backward"/></barline>',
    );
    expect(buildTimeline(repeated).issues.join()).toContain('反复');
    expect(parseScore(repeated).xml).toBe(repeated);
  });
  it('keeps timewise in explicit source-only mode', () => {
    const timewise =
      '<score-timewise version="4.0"><part-list/><measure number="1"/></score-timewise>';
    const s = parseScore(timewise);
    expect(s.readonly).toBe(true);
    expect(s.xml).toBe(timewise);
    expect(() => appendMeasure(timewise)).toThrow('仅支持');
    expect(() => buildTimeline(s)).toThrow('timewise');
  });
  it('rejects malformed XML, entities and invalid duration', () => {
    expect(() => parseScore('<score-partwise>')).toThrow('语法');
    expect(() =>
      parseScore('<!DOCTYPE x [<!ENTITY x "x">]><score-partwise/>'),
    ).toThrow('实体');
    expect(() =>
      parseScore(
        xml.replace('<duration>12</duration>', '<duration>0</duration>'),
      ),
    ).toThrow('时值');
  });
  it('supports default namespaces and pickup measures', () => {
    const source =
      '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml"><part-list/><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note></measure><measure number="1"><note><rest/><duration>6</duration></note></measure></part></score-partwise>';
    expect(parseScore(source).duration).toBe(3.5);
    const updated = changePitch(source, 'p0m0n0', {
      step: 'D',
      alter: 1,
      octave: 4,
    });
    expect(parseScore(updated).notes[0].midi).toBe(63);
    expect(parseScore(updated).notes[0].element.namespaceURI).toContain(
      'musicxml',
    );
  });
});
describe('conservative graphical editing', () => {
  it('patches pitch while preserving lyrics, metadata, foreign extensions and other notes', () => {
    const updated = changePitch(xml, 'p0m0n0', {
      step: 'F',
      alter: 1,
      octave: 4,
    });
    const s = parseScore(updated);
    expect(s.notes[0].midi).toBe(66);
    expect(s.notes[0].element.getAttributeNS('urn:puxie:test', 'keep')).toBe(
      'yes',
    );
    expect(updated).toContain('留住我');
    expect(updated).toContain('vendor:custom');
    expect(updated).toContain('Preserve this comment');
    expect(updated).toContain('Original Composer');
    expect(descendants(s.document, 'backup').length).toBe(3);
    expect(s.notes[1].midi).toBe(64);
  });
  it('does not retime other notes/voices when shortening a chord', () => {
    const updated = changeRhythm(xml, 'p0m0n0', 'eighth', 0),
      s = parseScore(updated);
    expect(s.notes.slice(0, 3).every((n) => n.duration === 0.5)).toBe(true);
    expect(s.notes[3].start).toBe(1);
    expect(s.notes.find((n) => n.voice === '2')!.start).toBe(0);
    expect(s.duration).toBe(8);
  });
  it('refuses overwriting the next note with an increased duration', () => {
    expect(() => changeRhythm(xml, 'p0m0n0', 'half', 0)).toThrow('覆盖');
  });
  it('can update triplet notation with an exact rational duration', () => {
    const source = xml.replace(
      '<duration>4</duration>',
      '<duration>4</duration>',
    );
    // Shortening to a sixteenth triplet leaves the next onset untouched.
    const result = parseScore(changeRhythm(source, 'p0m1n1', '16th', 0));
    expect(result.notes.find((n) => n.id === 'p0m1n1')!.duration).toBeCloseTo(
      1 / 6,
    );
    expect(result.notes.find((n) => n.id === 'p0m1n2')!.start).toBeCloseTo(
      5 + 1 / 3,
    );
    expect(result.xml).toContain('tuplet');
  });
  it('adds a chord tone with valid child order and no duplicated annotations', () => {
    const result = parseScore(
      addChordTone(pitched(), 'p0m0n0', { step: 'F', alter: 1, octave: 4 }),
    );
    const added = result.notes[1];
    expect(added.chord).toBe(true);
    expect(added.start).toBe(0);
    expect(added.midi).toBe(66);
    const names = kids(added.element).map((e) => e.localName);
    expect(names.indexOf('duration')).toBeLessThan(names.indexOf('accidental'));
    expect(names.indexOf('type')).toBeLessThan(names.indexOf('accidental'));
  });
  it('inserts an independent voice without moving the existing voices', () => {
    const result = parseScore(
      insertNote(xml, {
        partIndex: 0,
        measureIndex: 0,
        staff: 1,
        voice: '4',
        onset: 0,
        type: 'quarter',
        dots: 0,
        rest: false,
        step: 'B',
        alter: 0,
        octave: 4,
      }),
    );
    const added = result.notes.find((n) => n.voice === '4')!;
    expect(added.start).toBe(0);
    expect(added.duration).toBe(1);
    expect(result.notes.find((n) => n.voice === '2')!.start).toBe(0);
    expect(() =>
      insertNote(xml, {
        partIndex: 0,
        measureIndex: 0,
        staff: 1,
        voice: '1',
        onset: 0,
        type: 'quarter',
        dots: 0,
        rest: false,
        step: 'B',
        alter: 0,
        octave: 4,
      }),
    ).toThrow('已有音符');
  });
  it('turns standalone deletion into an equal-duration rest', () => {
    const result = parseScore(deleteNote(pitched(), 'p0m0n0'));
    expect(result.notes[0].rest).toBe(true);
    expect(result.notes[0].duration).toBe(1);
    expect(result.notes[1].start).toBe(1);
    expect(result.duration).toBe(4);
  });
  it('promotes a surviving chord tone on deletion of the root', () => {
    const result = parseScore(
      deleteNote(
        addChordTone(pitched(), 'p0m0n0', { step: 'E', alter: 0, octave: 4 }),
        'p0m0n0',
      ),
    );
    expect(result.notes[0].chord).toBe(false);
    expect(result.notes[0].midi).toBe(64);
    expect(result.notes[1].start).toBe(1);
  });
  it('refuses silent loss of decorations or extended data on deletion', () => {
    expect(() => deleteNote(xml, 'p0m0n0')).toThrow('扩展信息');
    expect(() =>
      changePitch(xml, 'p0m0n5', { step: 'D', alter: 0, octave: 4 }),
    ).toThrow('延音线');
  });
  it('adds and removes matching tie endpoints', () => {
    let source = pitched();
    source = changePitch(source, 'p0m0n1', { step: 'C', alter: 0, octave: 4 });
    const tied = toggleTie(source, 'p0m0n0');
    expect(buildTimeline(tied).notes[0].duration).toBe(2);
    const untied = parseScore(toggleTie(tied, 'p0m0n1'));
    expect(untied.notes[0].tieStart).toBe(false);
    expect(untied.notes[1].tieStop).toBe(false);
  });
  it('requires adjacent equal pitches for sounding ties', () => {
    expect(() => toggleTie(xml, 'p0m0n3')).toThrow('同声部');
  });
  it('adds/removes slurs while preserving unrelated notations', () => {
    let source = pitched();
    source = changePitch(source, 'p0m0n1', { step: 'D', alter: 0, octave: 4 });
    const slurred = toggleSlur(source, 'p0m0n0', 'p0m0n1');
    expect(descendants(parseScore(slurred).document, 'slur').length).toBe(2);
    const removed = toggleSlur(slurred, 'p0m0n0', 'p0m0n1');
    expect(descendants(parseScore(removed).document, 'slur').length).toBe(0);
  });
  it('creates a valid piano grand staff and adds synchronized measures', () => {
    const source = createPianoScore('A & B');
    const s = parseScore(appendMeasure(source));
    expect(s.title).toBe('A & B');
    expect(s.duration).toBe(8);
    expect(s.parts[0].measures[1].notes.map((n) => n.staff)).toEqual([1, 2]);
    expect(s.parts[0].measures[1].notes.map((n) => n.start)).toEqual([4, 4]);
  });
  it('converts a single pitch to rest and back', () => {
    const source = makeRest(pitched(), 'p0m0n0');
    expect(parseScore(source).notes[0].rest).toBe(true);
    expect(
      parseScore(
        changePitch(source, 'p0m0n0', { step: 'A', alter: -1, octave: 3 }),
      ).notes[0].midi,
    ).toBe(56);
  });
  it('refuses risky mid-measure divisions structural changes', () => {
    const source = pitched().replace(
      '</note>',
      '</note><attributes><divisions>960</divisions></attributes>',
    );
    expect(() => changeRhythm(source, 'p0m0n0', 'eighth', 0)).toThrow(
      'divisions',
    );
  });
});
describe('history is lossless', () => {
  it('protects unpitched instrument information from piano conversion', () => {
    const source = createPianoScore().replace(
      '<rest/>',
      '<unpitched><display-step>C</display-step><display-octave>4</display-octave></unpitched>',
    );
    expect(() => makeRest(source, 'p0m0n0')).toThrow('打击乐');
    expect(() =>
      addChordTone(source, 'p0m0n0', { step: 'E', alter: 0, octave: 4 }),
    ).toThrow('固定音高');
    expect(parseScore(source).xml).toBe(source);
  });
  it('undoes and redoes exact XML and clears abandoned redo states', () => {
    const start = createHistory(xml);
    const edited = changePitch(xml, 'p0m0n0', {
      step: 'F',
      alter: 0,
      octave: 4,
    });
    const h = pushHistory(start, edited);
    expect(undo(h).present).toBe(xml);
    expect(redo(undo(h)).present).toBe(edited);
    expect(pushHistory(undo(h), pitched()).future).toEqual([]);
  });
  it('limits memory to 100 previous snapshots', () => {
    let h = createHistory('0');
    for (let i = 1; i <= 120; i++) h = pushHistory(h, String(i));
    expect(h.past.length).toBe(100);
  });
});
