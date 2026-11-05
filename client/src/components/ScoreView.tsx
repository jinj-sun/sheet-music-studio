import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  OpenSheetMusicDisplay,
  VexFlowGraphicalNote,
  VexFlowVoiceEntry,
} from 'opensheetmusicdisplay';
import {
  type Score,
  type ScoreNote,
  noteLabel,
  STEPS,
  descendants,
  child,
  make,
} from '../music/score';
import { isBeamSuppressed } from '../music/beams';

function respectClearedBeams(osmd: OpenSheetMusicDisplay, notes: ScoreNote[]) {
  if (!notes.length) return;
  const suppressed = new Map<string, number[]>();
  for (const n of notes) {
    const key = `${n.measureIndex}/${n.partIndex}/${n.staff}/${n.voice}`;
    const onsets = suppressed.get(key) || [];
    onsets.push(n.onset);
    suppressed.set(key, onsets);
  }
  // OSMD 2.2.1 accepts an exclusion list when generating automatic beams.
  // Extend it on these SVG measure instances to keep explicitly cleared notes flagged.
  type StemmableNote = VexFlowVoiceEntry['vfStaveNote'];
  for (const [index, measures] of osmd.GraphicSheet.MeasureList.entries()) {
    for (const measure of measures) {
      const staff = measure.ParentStaff;
      if (!staff) continue;
      const instrument = staff.ParentInstrument;
      const part = osmd.Sheet.Instruments.indexOf(instrument);
      const staffIndex = instrument.Staves.indexOf(staff) + 1;
      const excluded = measure.staffEntries.flatMap(
        (entry) =>
          entry.graphicalVoiceEntries.filter((voice) => {
            const source = voice.parentVoiceEntry;
            const key = `${index}/${part}/${staffIndex}/${source.ParentVoice.VoiceId}`;
            return (
              !source.IsGrace &&
              suppressed
                .get(key)
                ?.some(
                  (onset) =>
                    Math.abs(onset - source.Timestamp.RealValue * 4) < 1e-6,
                )
            );
          }) as VexFlowVoiceEntry[],
      );
      if (!excluded.length) continue;
      const renderer = measure as unknown as {
        autoBeamNotes(notes: StemmableNote[]): void;
      };
      const autoBeam = renderer.autoBeamNotes;
      renderer.autoBeamNotes = (beamed) => {
        const notes = excluded
          .map((entry) => entry.vfStaveNote)
          .filter(Boolean);
        autoBeam.call(renderer, [...beamed, ...notes]);
      };
    }
  }
}

interface Props {
  score: Score;
  zoom: number;
  selection: string[];
  beat: number | null;
  checked: string[];
  followPlayback: boolean;
  jump: { measure: number } | null;
  onSelect: (id: string, extend: boolean) => void;
}
export default function ScoreView({
  score,
  zoom,
  selection,
  beat,
  checked,
  followPlayback,
  jump,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<OpenSheetMusicDisplay | null>(null);
  const targets = useRef(new Map<string, Element>());
  const followed = useRef('');
  const playingIds = useRef(new Set<string>());
  const index = useMemo(() => {
    const byMeasure = new Map<number, ScoreNote[]>(),
      byVoice = new Map<string, ScoreNote[]>();
    for (const n of score.notes) {
      const key = `${n.partIndex}/${n.measureIndex}/${n.staff}/${n.voice}`;
      const inMeasure = byMeasure.get(n.measureIndex) || [],
        inVoice = byVoice.get(key) || [];
      inMeasure.push(n);
      inVoice.push(n);
      byMeasure.set(n.measureIndex, inMeasure);
      byVoice.set(key, inVoice);
    }
    const measures = score.parts.reduce(
      (longest, p) =>
        p.measures.length > longest.length ? p.measures : longest,
      [] as Score['measures'],
    );
    return { byMeasure, byVoice, measures };
  }, [score]);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    let resizeTimer: ReturnType<typeof setTimeout>;
    const host = document.createElement('div');
    host.className = 'engraving';
    container.current?.replaceChildren(host);
    targets.current = new Map();
    playingIds.current.clear();
    setBusy(true);
    setError('');
    const render = async () => {
      try {
        const lib = await import('opensheetmusicdisplay');
        if (cancelled) return;
        const clearedNotes = score.notes.filter(isBeamSuppressed);
        const osmd = new lib.OpenSheetMusicDisplay(host, {
          backend: 'svg',
          autoResize: false,
          drawTitle: true,
          drawComposer: true,
          drawPartNames: true,
          drawFingerings: true,
          drawingParameters: 'default',
          followCursor: false,
          newSystemFromNewPageInXML: true,
          // Install the exclusions before auto-beaming can hide any flags.
          autoBeam: !clearedNotes.length,
          autoBeamOptions: {
            beam_rests: false,
            maintain_stem_directions: false,
          },
        });
        instance.current = osmd;
        osmd.Zoom = zoom;
        osmd.setLogLevel('warn');
        // Some exporters produce sound-only directions. OSMD 2.2.1 otherwise
        // swallows a parser exception and draws an empty measure. Repair only
        // the disposable display copy, never the canonical/imported XML.
        const display = score.document.cloneNode(true) as Document;
        for (const direction of descendants(display, 'direction'))
          if (!child(direction, 'direction-type')) {
            const type = make(direction, 'direction-type');
            type.appendChild(make(type, 'words', ''));
            direction.insertBefore(type, direction.firstChild);
          }
        await osmd.load(display);
        if (cancelled) {
          osmd.clear();
          return;
        }
        respectClearedBeams(osmd, clearedNotes);
        osmd.EngravingRules.AutoBeamNotes = true;
        for (const [
          measureIndex,
          measure,
        ] of osmd.Sheet.SourceMeasures.entries()) {
          const read = new Set(
            measure.VerticalSourceStaffEntryContainers.flatMap((c) =>
              c.StaffEntries.flatMap(
                (e) => e?.VoiceEntries.flatMap((v) => v.Notes) || [],
              ),
            ),
          ).size;
          const expected = (index.byMeasure.get(measureIndex) || []).filter(
            (n) => n.element.getAttribute('print-object') !== 'no',
          ).length;
          if (read < expected)
            throw new Error(
              `渲染器只读入第 ${measureIndex + 1} 小节的 ${read}/${expected} 个音符，请检查 XML 中的记号与结构`,
            );
        }
        const draw = () => {
          if (cancelled) return;
          osmd.render();
          const mapped = new Map<string, Element>();
          const used = new Set<string>();
          for (const [
            measureIndex,
            measures,
          ] of osmd.GraphicSheet.MeasureList.entries()) {
            for (const measure of measures)
              for (const entry of measure.staffEntries)
                for (const voice of entry.graphicalVoiceEntries)
                  for (const graphical of voice.notes) {
                    const sn = graphical.sourceNote,
                      staff = sn.ParentStaff,
                      instrument = staff.ParentInstrument;
                    const partIndex =
                      osmd.Sheet.Instruments.indexOf(instrument);
                    const localStaff = instrument.Staves.indexOf(staff) + 1;
                    const onset = sn.ParentVoiceEntry.Timestamp.RealValue * 4;
                    const pitch = sn.Pitch;
                    const step = pitch
                      ? STEPS.find(
                          (s) =>
                            ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[
                              s
                            ] === pitch.FundamentalNote,
                        )
                      : undefined;
                    const sourceVoice = sn.ParentVoiceEntry.ParentVoice.VoiceId;
                    const candidates = (
                      index.byVoice.get(
                        `${partIndex}/${measureIndex}/${localStaff}/${sourceVoice}`,
                      ) || []
                    ).filter(
                      (n) =>
                        Math.abs(n.onset - onset) < 1e-6 &&
                        n.rest === sn.isRest() &&
                        (n.rest ||
                          (n.step === step &&
                            n.octave ===
                              pitch?.Octave + lib.Pitch.OctaveXmlDifference &&
                            Math.abs(n.alter - pitch.AccidentalHalfTones) <
                              1e-6)) &&
                        !used.has(n.id),
                    );
                    // Do not attach a guessed editing target when OSMD coalesces/rewrites notes.
                    if (candidates.length !== 1) continue;
                    const n = candidates[0],
                      g = graphical as VexFlowGraphicalNote;
                    const heads = g.getNoteheadSVGs?.() || [];
                    const target =
                      heads[g.vfnoteIndex] ||
                      (heads.length === 1 ? heads[0] : undefined);
                    if (!target) continue;
                    target.setAttribute('data-note-id', n.id);
                    target.setAttribute('role', 'button');
                    target.setAttribute('tabindex', '0');
                    target.setAttribute(
                      'aria-label',
                      `谱面音符 ${noteLabel(n)}，第 ${n.measureIndex + 1} 小节，谱表 ${n.staff}，声部 ${n.voice}`,
                    );
                    target.classList.add('score-note');
                    target.addEventListener('click', (event) => {
                      event.stopPropagation();
                      const click = event as MouseEvent;
                      select.current(n.id, click.ctrlKey || click.metaKey);
                    });
                    target.addEventListener('keydown', (event) => {
                      if (
                        event instanceof KeyboardEvent &&
                        ['Enter', ' '].includes(event.key)
                      ) {
                        event.preventDefault();
                        select.current(n.id, event.ctrlKey || event.metaKey);
                      }
                    });
                    mapped.set(n.id, target);
                    used.add(n.id);
                  }
          }
          targets.current = mapped;
          playingIds.current.clear();
          setRevision((v) => v + 1);
        };
        draw();
        setBusy(false);
        let width = host.clientWidth;
        observer = new ResizeObserver(() => {
          if (Math.abs(width - host.clientWidth) < 2) return;
          width = host.clientWidth;
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(draw, 120);
        });
        observer.observe(host);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
      observer?.disconnect();
      clearTimeout(resizeTimer);
      instance.current = null;
    };
  }, [score, zoom, index]);
  useEffect(() => {
    if (!jump) return;
    const target = score.notes.find(
      (n) => n.measureIndex === jump.measure && targets.current.has(n.id),
    );
    const node = target && targets.current.get(target.id),
      viewport = container.current?.closest('.score-scroll');
    if (!node || !viewport) return;
    const rect = node.getBoundingClientRect(),
      bounds = viewport.getBoundingClientRect();
    viewport.scrollTop += rect.top - bounds.top - 90;
    viewport.scrollLeft += rect.left - bounds.left - 55;
  }, [jump, revision, score]);
  useEffect(() => {
    const done = new Set(checked);
    const selected = new Set(selection);
    for (const [id, element] of targets.current) {
      element.classList.toggle('selected-note', selected.has(id));
      element.classList.toggle('checked-note', done.has(id));
      element.setAttribute('aria-pressed', String(selected.has(id)));
    }
  }, [selection, checked, revision]);
  useEffect(() => {
    const active = new Set<string>();
    if (beat !== null) {
      // The canonical timeline has shared bar starts; binary-search the current bar.
      let lo = 0,
        hi = index.measures.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (index.measures[mid].start <= beat + 1e-7) lo = mid + 1;
        else hi = mid;
      }
      for (const n of index.byMeasure.get(lo - 1) || []) {
        if (
          !n.grace &&
          !n.cue &&
          beat >= n.start - 1e-7 &&
          beat < n.start + n.duration - 1e-7 &&
          targets.current.has(n.id)
        )
          active.add(n.id);
      }
    }
    for (const id of playingIds.current)
      if (!active.has(id))
        targets.current.get(id)?.classList.remove('playing-note');
    for (const id of active)
      if (!playingIds.current.has(id))
        targets.current.get(id)?.classList.add('playing-note');
    playingIds.current = active;
    const firstId = active.values().next().value;
    const firstActive = firstId && targets.current.get(firstId);
    if (beat === null) followed.current = '';
    if (followPlayback && firstActive) {
      const id = firstActive.getAttribute('data-note-id')!;
      const measure = id.split('n')[0];
      if (followed.current !== measure) {
        followed.current = measure;
        const viewport = container.current?.closest('.score-scroll');
        if (viewport) {
          const rect = firstActive.getBoundingClientRect(),
            bounds = viewport.getBoundingClientRect();
          if (rect.top < bounds.top + 30 || rect.bottom > bounds.bottom - 30)
            viewport.scrollTop +=
              rect.top - bounds.top - Math.min(100, bounds.height / 3);
          if (rect.left < bounds.left + 20 || rect.right > bounds.right - 20)
            viewport.scrollLeft += rect.left - bounds.left - 50;
        }
      }
    }
  }, [beat, revision, index, followPlayback]);
  return (
    <div className="score-paper" data-testid="score-paper">
      {busy && (
        <div className="render-status" role="status">
          正在排版乐谱…
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          谱面渲染失败：{error}。源码与项目仍完整保留，可切换 XML 修正或导出。
        </div>
      )}
      <div ref={container} className="score-host" />
    </div>
  );
}
