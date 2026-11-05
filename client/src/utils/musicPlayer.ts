import { logger } from '@lark-apaas/client-toolkit/logger';

export interface NoteEvent {
  pitch: number;
  duration: number;
  startTime: number;
  voice: number;
  staff: number;
  measureIndex: number;
}

export interface ParseResult {
  notes: NoteEvent[];
  totalDuration: number;
  entryTimes: number[];
}

const NOTE_TO_MIDI: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
  'A#': 10, Bb: 10, B: 11,
};

function noteNameToMidi(step: string, alter: number, octave: number): number {
  const base = NOTE_TO_MIDI[step] ?? 0;
  return (octave + 1) * 12 + base + alter;
}

function durationTypeToQuarters(type: string, dots: number): number {
  const baseMap: Record<string, number> = {
    '128th': 0.03125, '64th': 0.0625, '32nd': 0.125, '16th': 0.25,
    'eighth': 0.5, 'quarter': 1, 'half': 2, 'whole': 4,
    'breve': 8, 'long': 16, 'maxima': 32,
  };
  let base = baseMap[type] ?? 1;
  let multiplier = 1;
  let add = base / 2;
  for (let i = 0; i < dots; i++) {
    multiplier += add / base;
    add /= 2;
  }
  return base * multiplier;
}

export function parseMusicXml(musicXml: string): ParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(musicXml, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('MusicXML 解析失败');
  }

  const notes: NoteEvent[] = [];
  let totalDuration = 0;

  const parts = doc.querySelectorAll('part');
  parts.forEach((partEl) => {
    const measures = partEl.querySelectorAll('measure');
    let currentTime = 0;
    let divisions = 4;
    let fifths = 0;
    let beatType = 4;
    let beats = 4;

    measures.forEach((measureEl, measureIndex) => {
      const attrs = measureEl.querySelector('attributes');
      if (attrs) {
        const divEl = attrs.querySelector('divisions');
        if (divEl?.textContent) divisions = parseInt(divEl.textContent, 10);
        const fifthsEl = attrs.querySelector('fifths');
        if (fifthsEl?.textContent) fifths = parseInt(fifthsEl.textContent, 10);
        const beatsEl = attrs.querySelector('beats');
        if (beatsEl?.textContent) beats = parseInt(beatsEl.textContent, 10);
        const beatTypeEl = attrs.querySelector('beat-type');
        if (beatTypeEl?.textContent) beatType = parseInt(beatTypeEl.textContent, 10);
      }

      const measureNotes = measureEl.querySelectorAll(':scope > note');
      let chordTime = currentTime;

      measureNotes.forEach((noteEl, noteIdx) => {
        const isChord = noteEl.querySelector('chord') !== null;
        const isRest = noteEl.querySelector('rest') !== null;
        const pitchEl = noteEl.querySelector('pitch');
        const stepEl = pitchEl?.querySelector('step');
        const alterEl = pitchEl?.querySelector('alter');
        const octaveEl = pitchEl?.querySelector('octave');
        const durationEl = noteEl.querySelector('duration');
        const typeEl = noteEl.querySelector('type');
        const dotEls = noteEl.querySelectorAll('dot');
        const voiceEl = noteEl.querySelector('voice');
        const staffEl = noteEl.querySelector('staff');

        const voice = voiceEl?.textContent ? parseInt(voiceEl.textContent, 10) : 1;
        const staff = staffEl?.textContent ? parseInt(staffEl.textContent, 10) : 1;

        let durationQuarters: number;
        if (durationEl?.textContent && divisions > 0) {
          durationQuarters = parseInt(durationEl.textContent, 10) / divisions;
        } else if (typeEl?.textContent) {
          durationQuarters = durationTypeToQuarters(typeEl.textContent, dotEls.length);
        } else {
          durationQuarters = 1;
        }

        if (isChord && noteIdx > 0) {
          chordTime = currentTime;
        }

        if (!isRest && stepEl?.textContent && octaveEl?.textContent) {
          const step = stepEl.textContent;
          const alter = alterEl?.textContent ? parseInt(alterEl.textContent, 10) : 0;
          const octave = parseInt(octaveEl.textContent, 10);
          const midi = noteNameToMidi(step, alter, octave);

          notes.push({
            pitch: midi,
            duration: durationQuarters,
            startTime: isChord ? chordTime : currentTime,
            voice,
            staff,
            measureIndex,
          });
        }

        if (!isChord) {
          currentTime += durationQuarters;
        }
      });
    });

    if (currentTime > totalDuration) {
      totalDuration = currentTime;
    }
  });

  const startTimeSet = new Set(notes.map((n: NoteEvent) => n.startTime));
  const entryTimes = Array.from(startTimeSet).sort((a: number, b: number) => a - b);

  return { notes, totalDuration, entryTimes };
}

export interface PlayerOptions {
  tempo?: number;
  volume?: number;
  onProgress?: (currentTime: number, totalTime: number) => void;
  onNoteStart?: (note: NoteEvent) => void;
  onEntryChange?: (entryIndex: number, startTime: number) => void;
  onEnd?: () => void;
}

export class MusicPlayer {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private notes: NoteEvent[] = [];
  private entryTimes: number[] = [];
  private totalDuration: number = 0;
  private tempo: number = 100;
  private volume: number = 0.5;
  private isPlaying: boolean = false;
  private startTime: number = 0;
  private offset: number = 0;
  private scheduledOscillators: OscillatorNode[] = [];
  private scheduledGains: GainNode[] = [];
  private timeoutIds: ReturnType<typeof setTimeout>[] = [];
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private onProgress?: (currentTime: number, totalTime: number) => void;
  private onNoteStart?: (note: NoteEvent) => void;
  private onEntryChange?: (entryIndex: number, startTime: number) => void;
  private onEnd?: () => void;

  loadMusic(musicXml: string): void {
    const result = parseMusicXml(musicXml);
    this.notes = result.notes;
    this.entryTimes = result.entryTimes;
    this.totalDuration = result.totalDuration;
    logger.info(`解析乐谱：${this.notes.length} 个音符，${this.entryTimes.length} 个时间点，总时长 ${this.totalDuration.toFixed(2)} 拍`);
  }

  setOptions(options: PlayerOptions): void {
    if (options.tempo !== undefined) this.tempo = options.tempo;
    if (options.volume !== undefined) {
      this.volume = options.volume;
      if (this.masterGain) {
        this.masterGain.gain.value = this.volume;
      }
    }
    if (options.onProgress) this.onProgress = options.onProgress;
    if (options.onNoteStart) this.onNoteStart = options.onNoteStart;
    if (options.onEntryChange) this.onEntryChange = options.onEntryChange;
    if (options.onEnd) this.onEnd = options.onEnd;
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.audioContext.destination);
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  private playPianoNote(midi: number, startTime: number, durationSec: number, velocity: number = 0.7): void {
    const ctx = this.audioContext!;
    const master = this.masterGain!;

    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, startTime);

    const harmonics = [
      { ratio: 1, gain: velocity * 0.6 },
      { ratio: 2, gain: velocity * 0.2 },
      { ratio: 3, gain: velocity * 0.08 },
      { ratio: 4, gain: velocity * 0.04 },
    ];

    harmonics.forEach(({ ratio, gain }) => {
      const osc = ctx.createOscillator();
      osc.type = ratio === 1 ? 'triangle' : 'sine';
      osc.frequency.value = freq * ratio;
      const harmonicGain = ctx.createGain();
      harmonicGain.gain.value = gain;
      osc.connect(harmonicGain);
      harmonicGain.connect(noteGain);
      osc.start(startTime);
      osc.stop(startTime + durationSec + 0.1);
      this.scheduledOscillators.push(osc);
      this.scheduledGains.push(harmonicGain);
    });

    const attack = 0.005;
    const decay = 0.1;
    const sustain = velocity * 0.3;
    const release = Math.min(durationSec * 0.3, 0.3);

    noteGain.gain.setValueAtTime(0, startTime);
    noteGain.gain.linearRampToValueAtTime(velocity, startTime + attack);
    noteGain.gain.linearRampToValueAtTime(sustain, startTime + attack + decay);
    noteGain.gain.setValueAtTime(sustain, startTime + durationSec);
    noteGain.gain.linearRampToValueAtTime(0, startTime + durationSec + release);

    noteGain.connect(master);
    this.scheduledGains.push(noteGain);
  }

  play(startOffset: number = 0): void {
    if (this.notes.length === 0) return;

    this.stop();

    const ctx = this.ensureAudioContext();
    this.isPlaying = true;
    this.offset = startOffset;
    this.startTime = ctx.currentTime;

    const quarterNoteSec = 60 / this.tempo;
    const totalSec = this.totalDuration * quarterNoteSec;

    for (const note of this.notes) {
      const noteStartSec = note.startTime * quarterNoteSec;
      const noteDurSec = note.duration * quarterNoteSec;

      if (noteStartSec + noteDurSec < startOffset * quarterNoteSec) continue;

      const scheduleTime = this.startTime + (noteStartSec - startOffset * quarterNoteSec);

      if (scheduleTime >= ctx.currentTime - 0.01) {
        this.playPianoNote(note.pitch, scheduleTime, noteDurSec * 0.95);

        const timeoutId = setTimeout(() => {
          this.onNoteStart?.(note);
        }, Math.max(0, (scheduleTime - ctx.currentTime) * 1000));
        this.timeoutIds.push(timeoutId);
      }
    }

    if (this.onEntryChange) {
      const startEntryIdx = this.getEntryIndexByTime(startOffset);
      for (let i = startEntryIdx; i < this.entryTimes.length; i++) {
        const entryStartSec = this.entryTimes[i] * quarterNoteSec;
        const scheduleTime = this.startTime + (entryStartSec - startOffset * quarterNoteSec);
        if (scheduleTime >= ctx.currentTime - 0.01) {
          const idx = i;
          const entryTime = this.entryTimes[i];
          const timeoutId = setTimeout(() => {
            this.onEntryChange?.(idx, entryTime);
          }, Math.max(0, (scheduleTime - ctx.currentTime) * 1000));
          this.timeoutIds.push(timeoutId);
        }
      }
    }

    const endTimeMs = Math.max(0, (totalSec - startOffset * quarterNoteSec) * 1000);
    const endTimeout = setTimeout(() => {
      this.isPlaying = false;
      this.stopProgressTimer();
      this.onProgress?.(this.totalDuration, this.totalDuration);
      this.onEnd?.();
    }, endTimeMs + 100);
    this.timeoutIds.push(endTimeout);

    this.startProgressTimer();
  }

  pause(): number {
    if (!this.isPlaying || !this.audioContext) return this.offset;

    const ctx = this.audioContext;
    const elapsed = ctx.currentTime - this.startTime;
    const quarterNoteSec = 60 / this.tempo;
    const currentQuarter = this.offset + elapsed / quarterNoteSec;

    this.offset = Math.min(currentQuarter, this.totalDuration);
    this.clearSchedule();
    this.isPlaying = false;
    this.stopProgressTimer();

    return this.offset;
  }

  stop(): void {
    this.clearSchedule();
    this.isPlaying = false;
    this.offset = 0;
    this.stopProgressTimer();
  }

  private clearSchedule(): void {
    this.timeoutIds.forEach((id) => clearTimeout(id));
    this.timeoutIds = [];

    this.scheduledOscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        // 已停止或未启动
      }
    });
    this.scheduledOscillators = [];
    this.scheduledGains = [];

    if (this.masterGain && this.audioContext) {
      try {
        this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.masterGain.gain.value = this.volume;
      } catch {
        // ignore
      }
    }
  }

  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.progressTimer = setInterval(() => {
      if (!this.isPlaying || !this.audioContext) return;
      const elapsed = this.audioContext.currentTime - this.startTime;
      const quarterNoteSec = 60 / this.tempo;
      const currentQuarter = this.offset + elapsed / quarterNoteSec;
      this.onProgress?.(Math.min(currentQuarter, this.totalDuration), this.totalDuration);
    }, 50);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getTotalDuration(): number {
    return this.totalDuration;
  }

  getCurrentTime(): number {
    if (!this.isPlaying || !this.audioContext) return this.offset;
    const elapsed = this.audioContext.currentTime - this.startTime;
    const quarterNoteSec = 60 / this.tempo;
    return Math.min(this.offset + elapsed / quarterNoteSec, this.totalDuration);
  }

  getEntryIndexByTime(time: number): number {
    if (this.entryTimes.length === 0) return 0;
    let left = 0;
    let right = this.entryTimes.length - 1;
    while (left < right) {
      const mid = Math.ceil((left + right) / 2);
      if (this.entryTimes[mid] <= time) {
        left = mid;
      } else {
        right = mid - 1;
      }
    }
    return left;
  }

  getEntryCount(): number {
    return this.entryTimes.length;
  }

  dispose(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.masterGain = null;
    }
    this.notes = [];
    this.totalDuration = 0;
  }
}
