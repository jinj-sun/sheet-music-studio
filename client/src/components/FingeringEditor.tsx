import { useEffect, useMemo, useState } from 'react';
import { Hand } from 'lucide-react';
import {
  applyFingerings,
  readFingering,
  suggestFingerings,
  type Finger,
} from '../music/fingering';
import { noteLabel, type Score, type ScoreNote } from '../music/score';

interface Props {
  score: Score;
  note?: ScoreNote;
  onCommand: (edit: (xml: string) => string, message: string) => void;
}
const names = [
  '不标注',
  '1 · 拇指',
  '2 · 食指',
  '3 · 中指',
  '4 · 无名指',
  '5 · 小指',
];
export default function FingeringEditor({ score, note, onCommand }: Props) {
  const current = readFingering(note),
    [manual, setManual] = useState(0),
    [scope, setScope] = useState('measure');
  const [draft, setDraft] = useState<ReturnType<
      typeof suggestFingerings
    > | null>(null),
    [chosen, setChosen] = useState(new Set<string>()),
    [error, setError] = useState('');
  const lookup = useMemo(
    () => new Map(score.notes.map((n) => [n.id, n])),
    [score],
  );
  useEffect(() => setManual(current.finger || 0), [note?.id, current.finger]);
  const scopeKey =
    scope === 'measure' ? `${note?.partIndex}/${note?.measureIndex}` : 'all';
  useEffect(() => {
    setDraft(null);
    setChosen(new Set());
    setError('');
  }, [score, scopeKey]);
  function generate() {
    try {
      const result = suggestFingerings(
        score,
        scope === 'measure' && note
          ? { partIndex: note.partIndex, measureIndex: note.measureIndex }
          : undefined,
      );
      setDraft(result);
      setChosen(new Set(result.suggestions.map((s) => s.id)));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <details className="inspector-section fingering-editor">
      <summary>
        <Hand size={15} />
        钢琴指法
      </summary>
      <label>
        当前音符指法
        <select
          aria-label="当前音符指法"
          value={manual}
          disabled={!note || note.rest || note.midi === null || current.complex}
          onChange={(e) => setManual(Number(e.target.value))}
        >
          {names.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {current.complex && (
        <p className="hint">现有多组指法/换指保留，请在 XML 中编辑。</p>
      )}
      <button
        type="button"
        className="full"
        disabled={!note || note.rest || note.midi === null || current.complex}
        onClick={() =>
          onCommand(
            (xml) =>
              applyFingerings(xml, [
                { id: note!.id, finger: manual ? (manual as Finger) : null },
              ]),
            manual ? '当前音符指法已更新' : '已移除当前音符指法',
          )
        }
      >
        应用当前指法
      </button>
      <label>
        指法建议范围
        <select
          aria-label="指法建议范围"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="measure">当前小节 · 双手</option>
          <option value="score">整首乐谱 · 双手</option>
        </select>
      </label>
      <button
        type="button"
        className="full"
        disabled={scope === 'measure' && !note}
        onClick={generate}
      >
        生成指法建议
      </button>
      <p className="hint">
        默认上谱表右手、下谱表左手。建议考虑相邻音、和弦及持续按键，应用前可挑选；已有指法不会被覆盖。
      </p>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <div className="finger-preview" aria-label="指法建议预览">
          <strong>
            建议 {draft.suggestions.length} 条 · 已选 {chosen.size} 条
          </strong>
          {!!draft.skipped && (
            <p className="hint">
              {draft.skipped} 组因跨度、持续键或复杂指法无法安全建议，已跳过。
            </p>
          )}
          {!!draft.suggestions.length && (
            <>
              <div className="button-pair">
                <button
                  type="button"
                  onClick={() =>
                    setChosen(new Set(draft.suggestions.map((s) => s.id)))
                  }
                >
                  全选建议
                </button>
                <button type="button" onClick={() => setChosen(new Set())}>
                  取消全选
                </button>
              </div>
              <div className="finger-choices">
                {draft.suggestions.map((s) => {
                  const n = lookup.get(s.id)!;
                  return (
                    <label className="checkbox" key={s.id}>
                      <input
                        type="checkbox"
                        aria-label={`指法建议 ${s.id}`}
                        checked={chosen.has(s.id)}
                        onChange={(e) =>
                          setChosen((old) => {
                            const next = new Set(old);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            return next;
                          })
                        }
                      />
                      {n.measureIndex + 1} 小节 ·{' '}
                      {n.staff === 1 ? '右手' : '左手'} {noteLabel(n)} ·{' '}
                      {s.finger} 指
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                className="primary full"
                disabled={!chosen.size}
                onClick={() =>
                  onCommand(
                    (xml) =>
                      applyFingerings(
                        xml,
                        draft.suggestions.filter((s) => chosen.has(s.id)),
                        true,
                      ),
                    `已附上 ${chosen.size} 条所选指法，可撤销`,
                  )
                }
              >
                附上所选指法
              </button>
            </>
          )}
        </div>
      )}
    </details>
  );
}
