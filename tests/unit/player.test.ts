import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MusicPlayer } from '../../client/src/music/player';
import { createPianoScore, changePitch } from '../../client/src/music/editor';
class Oscillator {
  type = 'sine';
  frequency = { value: 0 };
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: Array<number | undefined> = [];
  connect = vi.fn();
  disconnect = vi.fn();
  start(time: number) {
    this.starts.push(time);
  }
  stop(time?: number) {
    this.stops.push(time);
  }
}
class Gain {
  gain = {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}
class Context {
  static latest: Context;
  currentTime = 10;
  destination = {};
  oscillators: Oscillator[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    Context.latest = this;
  }
  createGain() {
    return new Gain();
  }
  createOscillator() {
    const o = new Oscillator();
    this.oscillators.push(o);
    return o;
  }
}
const music = () =>
  changePitch(
    changePitch(createPianoScore(), 'p0m0n0', {
      step: 'C',
      alter: 0,
      octave: 4,
    }),
    'p0m0n4',
    { step: 'C', alter: 0, octave: 3 },
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', Context);
});
afterEach(() => {
  vi.useRealTimers();
});
it('schedules both hands at the same real audio time', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  expect(Context.latest.oscillators).toHaveLength(6);
  expect(new Set(Context.latest.oscillators.map((o) => o.starts[0]))).toEqual(
    new Set([10]),
  );
  await p.dispose();
});
it('pause retains the beat and stop resets it', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  Context.latest.currentTime = 10.25;
  expect(p.pause()).toBeCloseTo(0.5);
  expect(p.getIsPlaying()).toBe(false);
  expect(p.getCurrentTime()).toBeCloseTo(0.5);
  p.stop();
  expect(p.getCurrentTime()).toBe(0);
  await p.dispose();
});
it('seeking into a held note sounds its remaining duration', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play(0.5);
  expect(Context.latest.oscillators).toHaveLength(6);
  expect(
    Context.latest.oscillators.every(
      (o) => o.starts[0] === 10 && o.stops[0]! > 10,
    ),
  ).toBe(true);
  await p.dispose();
});
it('live tempo changes preserve position and use the new speed', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  Context.latest.currentTime = 10.25;
  p.setOptions({ tempo: 60 });
  await Promise.resolve();
  await Promise.resolve();
  expect(p.getCurrentTime()).toBeCloseTo(0.5);
  Context.latest.currentTime = 10.5;
  expect(p.getCurrentTime()).toBeCloseTo(0.75);
  await p.dispose();
});
it('score replacement cancels previously scheduled audio', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  const old = [...Context.latest.oscillators];
  p.loadMusic(createPianoScore());
  expect(p.getIsPlaying()).toBe(false);
  expect(old.every((o) => o.stops.includes(undefined))).toBe(true);
  await p.dispose();
  expect(Context.latest.close).toHaveBeenCalledOnce();
});
it('a cancelled asynchronous start cannot restart playback', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  const pending = p.play();
  p.stop();
  await pending;
  expect(p.getIsPlaying()).toBe(false);
  expect(Context.latest.oscillators).toHaveLength(0);
  await p.dispose();
});
