/** Salamander Grand Piano, Alexander Holm, CC BY 3.0. See public/audio/piano. */
export const PIANO_ROOTS = Array.from({ length: 30 }, (_, i) => 21 + i * 3);
export function pianoSample(pitch: number) {
  const root = PIANO_ROOTS.reduce((a, b) =>
    Math.abs(b - pitch) < Math.abs(a - pitch) ? b : a,
  );
  const names: Record<number, string> = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };
  return {
    root,
    name: `${names[root % 12]}${Math.floor(root / 12) - 1}`,
    rate: 2 ** ((pitch - root) / 12),
  };
}

export class PianoSampler {
  private buffers = new Map<number, Promise<AudioBuffer>>();
  private decoded = new Map<number, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  constructor(
    private context: AudioContext,
    private output: AudioNode,
  ) {}

  async prepare(pitches: number[]) {
    const roots = [...new Set(pitches.map((p) => pianoSample(p).root))];
    let index = 0;
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(4, roots.length) }, async () => {
        while (index < roots.length) await this.load(roots[index++]);
      }),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  private load(root: number): Promise<AudioBuffer> {
    const cached = this.buffers.get(root);
    if (cached) return cached;
    const name = pianoSample(root).name;
    const pending = (async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}audio/piano/${name}.mp3`,
          {
            signal: AbortSignal.timeout(15000),
          },
        );
        if (
          !response.ok ||
          response.headers.get('content-type')?.includes('text/html')
        )
          throw new Error(`HTTP ${response.status}`);
        const buffer = await this.context.decodeAudioData(
          await response.arrayBuffer(),
        );
        this.decoded.set(root, buffer);
        return buffer;
      } catch (error) {
        this.buffers.delete(root);
        throw new Error(
          `钢琴采样 ${name} 加载失败：${error instanceof Error ? error.message : String(error)}。请检查本地 audio/piano 资源后重试。`,
        );
      }
    })();
    this.buffers.set(root, pending);
    return pending;
  }

  // prepare() completes before the audio clock starts, including all simultaneous notes.
  note(
    pitch: number,
    start: number,
    duration: number,
    velocity: number,
    age = 0,
  ) {
    const sample = pianoSample(pitch);
    const buffer = this.decoded.get(sample.root);
    if (!buffer) return;
    const ctx = this.context,
      source = ctx.createBufferSource(),
      envelope = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    source.buffer = buffer;
    source.playbackRate.value = sample.rate;
    filter.type = 'lowpass';
    filter.frequency.value = 2400 + 12000 * velocity;
    filter.Q.value = 0.4;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.output);
    const gain = Math.max(0.001, velocity ** 1.5);
    // The recording supplies the hammer attack and natural string decay. No loop/organ sustain.
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(
      gain,
      start + Math.min(0.003, duration / 4),
    );
    envelope.gain.setValueAtTime(gain, start + duration);
    const release = 0.22 + Math.max(0, 60 - pitch) * 0.005;
    envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      start + duration + release,
    );
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
    const offset = Math.min(
      age * sample.rate,
      Math.max(0, buffer.duration - 0.005),
    );
    source.start(start, offset);
    source.stop(start + duration + release + 0.01);
  }
  stop() {
    for (const source of this.voices) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
    }
    this.voices.clear();
  }
}
