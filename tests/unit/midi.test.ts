import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMidi } from '../../client/src/music/midi';
const xml = readFileSync('tests/fixtures/complex.musicxml', 'utf8');
// Independent SMF decoder: assert real encoded absolute event times, not writer internals.
function decode(data: Uint8Array) {
  const d = new DataView(data.buffer);
  let p = 14;
  const tracks: Array<
    Array<{
      tick: number;
      status: number;
      pitch?: number;
      meta?: number;
      bytes?: number[];
    }>
  > = [];
  const variable = () => {
    let v = 0,
      b = 0;
    do {
      b = data[p++];
      v = (v << 7) | (b & 127);
    } while (b & 128);
    return v;
  };
  while (p < data.length) {
    expect(String.fromCharCode(...data.slice(p, p + 4))).toBe('MTrk');
    const size = d.getUint32(p + 4);
    p += 8;
    const end = p + size;
    let tick = 0;
    const events: (typeof tracks)[number] = [];
    while (p < end) {
      tick += variable();
      const status = data[p++];
      if (status === 255) {
        const meta = data[p++],
          len = variable(),
          bytes = [...data.slice(p, p + len)];
        p += len;
        events.push({ tick, status, meta, bytes });
      } else {
        const pitch = data[p++];
        if ((status & 240) !== 192 && (status & 240) !== 208) p++;
        events.push({ tick, status, pitch });
      }
    }
    tracks.push(events);
  }
  return { tracks, ppq: d.getUint16(12), format: d.getUint16(8) };
}
it('blocks MIDI until unsupported interpretation is acknowledged', () => {
  expect(() => createMidi(xml)).toThrow('近似演奏');
});
it('encodes simultaneous chords and independent voice/staff tracks', () => {
  const result = decode(createMidi(xml, true));
  expect(result.format).toBe(1);
  expect(result.tracks.length).toBe(5);
  const right = result.tracks[1].filter((e) => (e.status & 240) === 144);
  expect(right.slice(0, 3).map((e) => e.tick)).toEqual([0, 0, 0]);
  expect(right.slice(0, 3).map((e) => e.pitch)).toEqual([60, 64, 67]);
  const left = result.tracks[2].filter((e) => (e.status & 240) === 144);
  expect(left[0].tick).toBe(0);
  expect(left[0].pitch).toBe(48);
  expect(result.tracks[3].find((e) => (e.status & 240) === 144)!.tick).toBe(0);
});
it('encodes tempo changes and sustained tie without duplicate note-on', () => {
  const { tracks, ppq } = decode(createMidi(xml, true));
  const tempos = tracks[0].filter((e) => e.meta === 81);
  expect(tempos.map((e) => e.tick)).toEqual([0, ppq * 4]);
  expect(tempos.map((e) => e.bytes)).toEqual([
    [7, 161, 32],
    [15, 66, 64],
  ]);
  const right = tracks[1];
  expect(
    right
      .filter((e) => (e.status & 240) === 144 && e.pitch === 60)
      .map((e) => e.tick),
  ).toEqual([0, 3 * ppq]);
  expect(
    right.some(
      (e) => (e.status & 240) === 128 && e.pitch === 60 && e.tick === 5 * ppq,
    ),
  ).toBe(true);
  expect(
    right.filter((e) => (e.status & 240) === 144).some((e) => e.pitch === 0),
  ).toBe(false);
});
it('exports playback speed as proportional tempo map', () => {
  const result = decode(createMidi(xml, true, 2));
  expect(result.tracks[0].find((e) => e.meta === 81)!.bytes).toEqual([
    3, 208, 144,
  ]);
});
