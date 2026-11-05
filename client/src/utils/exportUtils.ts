import { logger } from '@lark-apaas/client-toolkit/logger';

export function exportMusicXml(musicXml: string, filename: string): void {
  const blob = new Blob([musicXml], { type: 'application/vnd.recordare.musicxml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  logger.info('MusicXML 已导出', filename);
}

const NOTE_TO_MIDI: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
  'A#': 10, Bb: 10, B: 11,
};

interface ParsedNote {
  midiNote: number;
  duration: string;
  isRest: boolean;
  isChord: boolean;
  voice: number;
}

interface ParsedMeasure {
  notes: ParsedNote[];
}

interface ParsedPart {
  id: string;
  measures: ParsedMeasure[];
}

function parseMusicXml(xml: string): ParsedPart[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('MusicXML 解析失败');
  }

  const parts: ParsedPart[] = [];
  const partElements = doc.querySelectorAll('part');

  for (const partEl of partElements) {
    const partId = partEl.getAttribute('id') || 'P1';
    const measures: ParsedMeasure[] = [];
    const measureElements = partEl.querySelectorAll('measure');

    for (const measureEl of measureElements) {
      const notes: ParsedNote[] = [];
      const noteElements = measureEl.querySelectorAll(':scope > note');

      for (const noteEl of noteElements) {
        const isRest = noteEl.querySelector('rest') !== null;
        const isChord = noteEl.querySelector('chord') !== null;
        const voice = parseInt(noteEl.querySelector('voice')?.textContent || '1', 10);

        let duration = '4';
        const typeEl = noteEl.querySelector('type');
        if (typeEl?.textContent) {
          duration = typeEl.textContent;
        }

        let midiNote = 60;
        if (!isRest) {
          const pitchEl = noteEl.querySelector('pitch');
          if (pitchEl) {
            const step = pitchEl.querySelector('step')?.textContent || 'C';
            const octave = parseInt(pitchEl.querySelector('octave')?.textContent || '4', 10);
            const alter = parseInt(pitchEl.querySelector('alter')?.textContent || '0', 10);

            const baseNote = NOTE_TO_MIDI[step] ?? 0;
            midiNote = (octave + 1) * 12 + baseNote + alter;
          }
        }

        notes.push({ midiNote, duration, isRest, isChord, voice });
      }

      measures.push({ notes });
    }

    parts.push({ id: partId, measures });
  }

  return parts;
}

function durationTypeToTicks(type: string, divisions: number): number {
  const typeMap: Record<string, number> = {
    'whole': 4,
    'half': 2,
    'quarter': 1,
    'eighth': 0.5,
    '16th': 0.25,
    '32nd': 0.125,
    '64th': 0.0625,
    'breve': 8,
    'long': 16,
    'maxima': 32,
  };
  const beats = typeMap[type] ?? 1;
  return Math.round(beats * divisions);
}

export async function exportMidi(musicXml: string, filename: string): Promise<void> {
  const midiWriterModule = await import('midi-writer-js');
  const MidiWriter = midiWriterModule.default || midiWriterModule;

  const parts = parseMusicXml(musicXml);

  if (parts.length === 0) {
    throw new Error('未找到任何声部');
  }

  const track = new MidiWriter.Track();
  track.setTempo(120);
  track.addTrackName('Piano');

  const divisions = 128;

  for (const part of parts) {
    for (const measure of part.measures) {
      let currentVoice = 1;
      const chordNotes: number[] = [];
      let chordDuration = 0;

      for (const note of measure.notes) {
        const ticks = durationTypeToTicks(note.duration, divisions);

        if (note.voice !== currentVoice && chordNotes.length > 0) {
          track.addEvent(new MidiWriter.NoteEvent({
            pitch: chordNotes,
            duration: 'T' + chordDuration,
          }));
          chordNotes.length = 0;
          currentVoice = note.voice;
        }

        if (note.isRest) {
          if (chordNotes.length > 0) {
            track.addEvent(new MidiWriter.NoteEvent({
              pitch: chordNotes,
              duration: 'T' + chordDuration,
            }));
            chordNotes.length = 0;
          }
          track.addEvent(new MidiWriter.NoteEvent({
            pitch: ['C0'],
            duration: 'T' + ticks,
            velocity: 0,
          }));
        } else if (note.isChord) {
          chordNotes.push(note.midiNote);
          chordDuration = Math.max(chordDuration, ticks);
        } else {
          if (chordNotes.length > 0) {
            track.addEvent(new MidiWriter.NoteEvent({
              pitch: chordNotes,
              duration: 'T' + chordDuration,
            }));
            chordNotes.length = 0;
          }
          chordNotes.push(note.midiNote);
          chordDuration = ticks;
        }
      }

      if (chordNotes.length > 0) {
        track.addEvent(new MidiWriter.NoteEvent({
          pitch: chordNotes,
          duration: 'T' + chordDuration,
        }));
      }
    }
  }

  const writer = new MidiWriter.Writer([track]);
  const dataUri = writer.dataUri();

  const a = document.createElement('a');
  a.href = dataUri;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  logger.info('MIDI 已导出', filename);
}
