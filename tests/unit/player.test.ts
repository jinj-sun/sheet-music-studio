import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pianoSample } from '../../client/src/music/piano';
import { MusicPlayer } from '../../client/src/music/player';
import { createPianoScore, changePitch } from '../../client/src/music/editor';
class Oscillator {
  type = 'sine';
  playbackRate = { value: 1 };
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  starts: number[] = [];
  offsets: number[] = [];
  stops: Array<number | undefined> = [];
  connect = vi.fn();
  disconnect = vi.fn();
  start(time: number, offset = 0) {
    this.starts.push(time);
    this.offsets.push(offset);
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
  sources: Oscillator[] = [];
  decodeAudioData = vi.fn(async () => ({ duration: 8 }) as AudioBuffer);
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    Context.latest = this;
  }
  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: vi.fn(),
    };
  }
  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: { value: 0 },
      Q: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  createGain() {
    return new Gain();
  }
  createBufferSource() {
    const o = new Oscillator();
    this.sources.push(o);
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
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2]), {
          headers: { 'content-type': 'audio/mpeg' },
        }),
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
});
it('schedules both hands at the same real audio time', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  expect(Context.latest.sources).toHaveLength(2);
  expect(new Set(Context.latest.sources.map((o) => o.starts[0]))).toEqual(
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
  expect(Context.latest.sources).toHaveLength(2);
  expect(
    Context.latest.sources.every((o) => o.starts[0] === 10 && o.stops[0]! > 10),
  ).toBe(true);
  await p.dispose();
});
it('live tempo changes preserve position and use the new speed', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  Context.latest.currentTime = 10.25;
  p.setOptions({ tempo: 60 });
  await vi.waitFor(() => expect(p.getIsPlaying()).toBe(true));
  expect(p.getCurrentTime()).toBeCloseTo(0.5);
  Context.latest.currentTime = 10.5;
  expect(p.getCurrentTime()).toBeCloseTo(0.75);
  await p.dispose();
});
it('score replacement cancels previously scheduled audio', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  const old = [...Context.latest.sources];
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
  expect(Context.latest.sources).toHaveLength(0);
  await p.dispose();
});

it('uses the closest real piano sample with exact equal-tempered resampling', () => {
  expect(pianoSample(60)).toEqual({ root: 60, name: 'C4', rate: 1 });
  expect(pianoSample(61).name).toBe('C4');
  expect(pianoSample(61).rate).toBeCloseTo(2 ** (1 / 12));
  expect(pianoSample(21).name).toBe('A0');
  expect(pianoSample(108).name).toBe('C8');
});
it('a missing sample reports an error, does not start the clock, and can be retried', async () => {
  const p = new MusicPlayer(),
    loading = vi.fn();
  p.loadMusic(music());
  p.setOptions({ onLoading: loading });
  vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
  await expect(p.play()).rejects.toThrow('钢琴采样');
  expect(p.getIsPlaying()).toBe(false);
  expect(Context.latest.sources).toHaveLength(0);
  expect(loading).toHaveBeenLastCalledWith(false);
  await p.play();
  expect(p.getIsPlaying()).toBe(true);
  expect(Context.latest.sources).toHaveLength(2);
  await p.dispose();
});
it('stopping during sample loading never starts a late voice', async () => {
  let release!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const p = new MusicPlayer();
  p.loadMusic(
    changePitch(createPianoScore(), 'p0m0n0', {
      step: 'C',
      alter: 0,
      octave: 4,
    }),
  );
  const pending = p.play();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  p.stop();
  release(new Response(new Uint8Array([1, 2])));
  await pending;
  expect(p.getIsPlaying()).toBe(false);
  expect(Context.latest.sources).toHaveLength(0);
  await p.dispose();
});
it('seek preserves the recording decay, and cached samples are reused', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play(0.5);
  expect(Context.latest.sources[0].offsets[0]).toBeCloseTo(0.25);
  const count = vi.mocked(fetch).mock.calls.length;
  await p.seek(0.25);
  expect(fetch).toHaveBeenCalledTimes(count);
  await p.dispose();
});

it('the final piano note keeps its release tail at natural completion', async () => {
  const p = new MusicPlayer();
  p.loadMusic(music());
  await p.play();
  const voices = [...Context.latest.sources];
  Context.latest.currentTime = 12;
  await vi.advanceTimersByTimeAsync(25);
  expect(p.getIsPlaying()).toBe(false);
  expect(voices.every((o) => !o.stops.includes(undefined))).toBe(true);
  p.stop();
  expect(voices.every((o) => o.stops.includes(undefined))).toBe(true);
  await p.dispose();
});
