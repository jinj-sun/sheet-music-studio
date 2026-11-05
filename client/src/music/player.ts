import {
  type Timeline,
  buildTimeline,
  beatToSeconds,
  secondsToBeat,
} from './timeline';
export interface PlayerOptions {
  tempo?: number;
  volume?: number;
  onProgress?: (beat: number, total: number) => void;
  onEnd?: () => void;
}
export class MusicPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timeline: Timeline = {
    notes: [],
    duration: 0,
    tempos: [{ beat: 0, bpm: 120 }],
    issues: [],
  };
  private running = false;
  private offset = 0;
  private epoch = 0;
  private speed = 1;
  private volume = 0.6;
  private nextNote = 0;
  private approximate = false;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nodes = new Set<OscillatorNode>();
  private onProgress?: PlayerOptions['onProgress'];
  private onEnd?: PlayerOptions['onEnd'];
  loadMusic(input: string | Timeline) {
    this.stop();
    this.timeline = typeof input === 'string' ? buildTimeline(input) : input;
  }
  setOptions(options: PlayerOptions) {
    if (options.tempo !== undefined) {
      const resume = this.running,
        position = this.pause();
      this.speed =
        Math.min(300, Math.max(20, options.tempo)) /
        (this.timeline.tempos[0]?.bpm || 120);
      if (resume) void this.play(position, this.approximate);
    }
    if (options.volume !== undefined) {
      this.volume = Math.min(1, Math.max(0, options.volume));
      if (this.master && this.context)
        this.master.gain.setTargetAtTime(
          this.volume * 0.2,
          this.context.currentTime,
          0.01,
        );
    }
    if (options.onProgress) this.onProgress = options.onProgress;
    if (options.onEnd) this.onEnd = options.onEnd;
  }
  async play(position = this.offset, allowApproximate = false) {
    if (this.timeline.issues.length && !allowApproximate)
      throw new Error('请先确认近似演奏选项');
    this.clear();
    this.approximate = allowApproximate;
    const generation = this.generation;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume * 0.2;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
    if (generation !== this.generation) return;
    this.offset = Math.max(0, Math.min(position, this.timeline.duration));
    if (this.offset >= this.timeline.duration) this.offset = 0;
    this.epoch = this.context.currentTime;
    this.running = true;
    this.nextNote = 0;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }
  private schedule() {
    if (!this.context || !this.running) return;
    const now = this.context.currentTime;
    const origin = beatToSeconds(this.offset, this.timeline.tempos);
    const elapsed = (now - this.epoch) * this.speed;
    while (this.nextNote < this.timeline.notes.length) {
      const n = this.timeline.notes[this.nextNote];
      const start = beatToSeconds(n.start, this.timeline.tempos);
      if ((start - origin) / this.speed > now - this.epoch + 0.15) break;
      this.nextNote++;
      const end = beatToSeconds(n.start + n.duration, this.timeline.tempos);
      if (end <= origin + elapsed) continue;
      // Seeking into a held/tied note schedules the remaining sounding duration.
      const scheduled = Math.max(
        now,
        this.epoch + (start - origin) / this.speed,
      );
      const duration = Math.max(
        0.005,
        this.epoch + (end - origin) / this.speed - scheduled,
      );
      this.tone(n.pitch, scheduled, duration, n.velocity / 127);
    }
    const current = this.getCurrentTime();
    this.onProgress?.(current, this.timeline.duration);
    if (current >= this.timeline.duration - 1e-6) {
      this.offset = this.timeline.duration;
      this.clear();
      this.onEnd?.();
    }
  }
  private tone(
    pitch: number,
    start: number,
    duration: number,
    velocity: number,
  ) {
    const ctx = this.context!,
      env = ctx.createGain();
    env.connect(this.master!);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(
      velocity,
      start + Math.min(0.004, duration / 4),
    );
    env.gain.exponentialRampToValueAtTime(
      Math.max(0.001, velocity * 0.22),
      start + Math.min(0.12, duration * 0.7),
    );
    env.gain.setValueAtTime(Math.max(0.001, velocity * 0.22), start + duration);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration + 0.05);
    let remaining = 3;
    for (const [ratio, amplitude] of [
      [1, 0.8],
      [2, 0.2],
      [3, 0.07],
    ]) {
      const osc = ctx.createOscillator(),
        harmonic = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12) * ratio;
      harmonic.gain.value = amplitude;
      osc.connect(harmonic);
      harmonic.connect(env);
      this.nodes.add(osc);
      osc.onended = () => {
        this.nodes.delete(osc);
        osc.disconnect();
        harmonic.disconnect();
        if (--remaining === 0) env.disconnect();
      };
      osc.start(start);
      osc.stop(start + duration + 0.06);
    }
  }
  getCurrentTime() {
    if (!this.running || !this.context) return this.offset;
    const seconds =
      beatToSeconds(this.offset, this.timeline.tempos) +
      (this.context.currentTime - this.epoch) * this.speed;
    return Math.min(
      this.timeline.duration,
      secondsToBeat(seconds, this.timeline.tempos),
    );
  }
  getTotalDuration() {
    return this.timeline.duration;
  }
  getIsPlaying() {
    return this.running;
  }
  pause() {
    const position = this.getCurrentTime();
    this.clear();
    this.offset = position;
    return position;
  }
  seek(position: number, allowApproximate = false) {
    const resume = this.running;
    this.pause();
    this.offset = Math.max(0, Math.min(position, this.timeline.duration));
    this.onProgress?.(this.offset, this.timeline.duration);
    if (resume) return this.play(this.offset, allowApproximate);
    return Promise.resolve();
  }
  stop() {
    this.clear();
    this.offset = 0;
    this.onProgress?.(0, this.timeline.duration);
  }
  private clear() {
    this.generation++;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const osc of this.nodes) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      osc.disconnect();
    }
    this.nodes.clear();
  }
  async dispose() {
    this.stop();
    await this.context?.close();
    this.context = null;
    this.master = null;
  }
}
