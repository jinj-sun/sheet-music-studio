import { memo, useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { noteLabel, type ScoreNote } from '../music/score';

interface Props {
  notes: ScoreNote[];
  selection: string[];
  checked: string[];
  onSelect: (id: string, extend: boolean) => void;
}
export default memo(function NoteStrip({
  notes,
  selection,
  checked,
  onSelect,
}: Props) {
  const strip = useRef<HTMLDivElement>(null),
    done = new Set(checked),
    selected = new Set(selection);
  useEffect(() => {
    if (strip.current) strip.current.scrollLeft = 0;
  }, [notes]);
  return (
    <div className="note-strip" ref={strip}>
      {notes.map((n) => (
        <button
          key={n.id}
          className={`${selected.has(n.id) ? 'active' : ''} ${done.has(n.id) ? 'checked' : ''}`}
          aria-pressed={selected.has(n.id)}
          aria-label={`选择 ${noteLabel(n)} 小节${n.measureIndex + 1} 谱表${n.staff} 声部${n.voice} 第${n.noteIndex + 1}音`}
          onClick={(event) => onSelect(n.id, event.ctrlKey || event.metaKey)}
        >
          <small>
            {n.measureIndex + 1}:{Number((n.onset + 1).toFixed(3))} ·{' '}
            {n.staff === 1 ? 'R' : n.staff === 2 ? 'L' : n.staff}v{n.voice}
          </small>
          <strong>
            {noteLabel(n)}
            {n.chord ? ' ◇' : ''}
          </strong>
          {done.has(n.id) && <CheckCircle2 size={11} />}
        </button>
      ))}
    </div>
  );
});
