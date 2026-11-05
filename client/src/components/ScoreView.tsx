import { useEffect, useRef, useState } from 'react';
import type {
  OpenSheetMusicDisplay,
  VexFlowGraphicalNote,
} from 'opensheetmusicdisplay';
import {
  type Score,
  noteLabel,
  STEPS,
  descendants,
  child,
  make,
} from '../music/score';
interface Props {
  score: Score;
  zoom: number;
  selected: string;
  beat: number | null;
  checked: string[];
  followPlayback: boolean;
  onSelect: (id: string) => void;
}
export default function ScoreView({
  score,
  zoom,
  selected,
  beat,
  checked,
  followPlayback,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<OpenSheetMusicDisplay | null>(null);
  const targets = useRef(new Map<string, Element>());
  const followed = useRef('');
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
    setBusy(true);
    setError('');
    const render = async () => {
      try {
        const lib = await import('opensheetmusicdisplay');
        if (cancelled) return;
        const osmd = new lib.OpenSheetMusicDisplay(host, {
          backend: 'svg',
          autoResize: false,
          drawTitle: true,
          drawComposer: true,
          drawPartNames: true,
          drawingParameters: 'default',
          followCursor: false,
          autoBeam: true,
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
        for (const [index, measure] of osmd.Sheet.SourceMeasures.entries()) {
          const read = new Set(
            measure.VerticalSourceStaffEntryContainers.flatMap((c) =>
              c.StaffEntries.flatMap(
                (e) => e?.VoiceEntries.flatMap((v) => v.Notes) || [],
              ),
            ),
          ).size;
          const expected = score.notes.filter(
            (n) =>
              n.measureIndex === index &&
              n.element.getAttribute('print-object') !== 'no',
          ).length;
          if (read < expected)
            throw new Error(
              `渲染器只读入第 ${index + 1} 小节的 ${read}/${expected} 个音符，请检查 XML 中的记号与结构`,
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
                    const candidates = score.notes.filter(
                      (n) =>
                        n.partIndex === partIndex &&
                        n.measureIndex === measureIndex &&
                        n.staff === localStaff &&
                        n.voice ===
                          String(sn.ParentVoiceEntry.ParentVoice.VoiceId) &&
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
                      select.current(n.id);
                    });
                    target.addEventListener('keydown', (event) => {
                      if (
                        event instanceof KeyboardEvent &&
                        ['Enter', ' '].includes(event.key)
                      ) {
                        event.preventDefault();
                        select.current(n.id);
                      }
                    });
                    mapped.set(n.id, target);
                    used.add(n.id);
                  }
          }
          targets.current = mapped;
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
  }, [score, zoom]);
  useEffect(() => {
    let firstActive: Element | undefined;
    for (const [id, element] of targets.current) {
      const n = score.notes.find((n) => n.id === id)!;
      element.classList.toggle('selected-note', selected === id);
      element.classList.toggle('checked-note', checked.includes(id));
      element.classList.toggle(
        'playing-note',
        beat !== null &&
          !n.grace &&
          !n.cue &&
          beat >= n.start - 1e-7 &&
          beat < n.start + n.duration - 1e-7,
      );
      element.setAttribute('aria-pressed', String(selected === id));
      if (!firstActive && element.classList.contains('playing-note'))
        firstActive = element;
    }
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
  }, [selected, beat, checked, revision, score, followPlayback]);
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
