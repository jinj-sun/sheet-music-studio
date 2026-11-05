import { PianoSampler } from './piano';
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
  onLoading?: (loading: boolean) => void;
  onError?: (error: unknown) => void;
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
  private piano: PianoSampler | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private onLoading?: PlayerOptions['onLoading'];
  private onError?: PlayerOptions['onError'];
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
      if (resume)
        void this.play(position, this.approximate).catch((e) =>
          this.onError?.(e),
        );
    }
    if (options.volume !== undefined) {
      this.volume = Math.min(1, Math.max(0, options.volume));
      if (this.master && this.context)
        this.master.gain.setTargetAtTime(
          this.volume * 0.7,
          this.context.currentTime,
          0.01,
        );
    }
    if (options.onProgress) this.onProgress = options.onProgress;
    if (options.onEnd) this.onEnd = options.onEnd;
    if (options.onLoading) this.onLoading = options.onLoading;
    if (options.onError) this.onError = options.onError;
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
      this.master.gain.value = this.volume * 0.7;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.2;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      this.piano = new PianoSampler(this.context, this.master);
    }
    this.onLoading?.(true);
    try {
      await this.context.resume();
      if (generation !== this.generation) return;
      await this.piano!.prepare(this.timeline.notes.map((n) => n.pitch));
    } catch (error) {
      if (generation !== this.generation) return;
      throw error;
    } finally {
      if (generation === this.generation) this.onLoading?.(false);
    }
    if (generation !== this.generation) return;
    this.offset = Math.max(0, Math.min(position, this.timeline.duration));
    if (this.offset >= this.timeline.duration) this.offset = 0;
    this.epoch = this.context.currentTime;
    this.running = true;
    this.nextNote = 0;
    this.schedule();
    if (this.running) this.timer = setInterval(() => this.schedule(), 25);
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
      const age = Math.max(0, (origin + elapsed - start) / this.speed);
      this.piano!.note(n.pitch, scheduled, duration, n.velocity / 127, age);
    }
    const current = this.getCurrentTime();
    this.onProgress?.(current, this.timeline.duration);
    if (current >= this.timeline.duration - 1e-6) {
      this.offset = this.timeline.duration;
      this.clear(false);
      this.onEnd?.();
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
  private clear(stopVoices = true) {
    this.generation++;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onLoading?.(false);
    if (stopVoices) this.piano?.stop();
  }
  async dispose() {
    this.stop();
    await this.context?.close();
    this.context = null;
    this.master = null;
    this.piano = null;
    this.compressor = null;
  }
}
