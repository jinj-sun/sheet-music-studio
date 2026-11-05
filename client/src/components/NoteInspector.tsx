import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Plus, Link2 } from 'lucide-react';
import {
  type Score,
  type ScoreNote,
  type NoteType,
  type Step,
  NOTE_TYPES,
  STEPS,
  noteLabel,
} from '../music/score';
import {
  changePitch,
  changeRhythm,
  makeRest,
  addChordTone,
  insertNote,
  toggleTie,
  toggleSlur,
  deleteNote,
} from '../music/editor';
import { joinBeam, clearBeam } from '../music/beams';
interface Props {
  score: Score;
  note?: ScoreNote;
  checked: string[];
  disabled: boolean;
  insertOpen: boolean;
  onSelect: (id: string) => void;
  onCommand: (action: (xml: string) => string, message: string) => void;
  onCheck: (id: string) => void;
}
const TYPE_LABELS: Record<NoteType, string> = {
  whole: '全音符',
  half: '二分音符',
  quarter: '四分音符',
  eighth: '八分音符',
  '16th': '十六分音符',
  '32nd': '三十二分音符',
  '64th': '六十四分音符',
  '128th': '一百二十八分音符',
};
export default function NoteInspector({
  score,
  note,
  checked,
  disabled,
  insertOpen,
  onSelect,
  onCommand,
  onCheck,
}: Props) {
  const [step, setStep] = useState<Step>('C'),
    [alter, setAlter] = useState(0),
    [octave, setOctave] = useState(4);
  const [type, setType] = useState<NoteType>('quarter'),
    [dots, setDots] = useState(0);
  const [voice, setVoice] = useState('1'),
    [staff, setStaff] = useState(1),
    [part, setPart] = useState(0),
    [measure, setMeasure] = useState(0),
    [onset, setOnset] = useState(0),
    [rest, setRest] = useState(false);
  const [slurStart, setSlurStart] = useState('');
  const [ripple, setRipple] = useState(false);
  useEffect(() => {
    if (note) {
      setStep(note.step);
      setAlter(note.alter);
      setOctave(note.octave);
      setType(note.type in NOTE_TYPES ? (note.type as NoteType) : 'quarter');
      setDots(note.dots);
      setVoice(note.voice);
      setStaff(note.staff);
      setPart(note.partIndex);
      setMeasure(note.measureIndex);
      setOnset(note.onset);
      setRest(note.rest);
    }
  }, [note]);
  useEffect(() => {
    setSlurStart('');
  }, [score.parts.length]);
  const pitch = { step, alter, octave };
  const ordered = [...score.notes].sort(
    (a, b) =>
      a.partIndex - b.partIndex ||
      a.staff - b.staff ||
      a.start - b.start ||
      a.noteIndex - b.noteIndex,
  );
  const index = ordered.findIndex((n) => n.id === note?.id);
  return (
    <aside className="inspector" aria-label="音符属性面板">
      <div className="panel-heading">
        <h2>音符属性</h2>
        <span className="eyebrow">INSPECTOR</span>
      </div>
      {note ? (
        <>
          <div className="selected-summary">
            <span className="note-symbol">{note.rest ? '𝄽' : '♪'}</span>
            <div>
              <strong>{noteLabel(note)}</strong>
              <small>
                第 {note.measureIndex + 1} 小节 · 谱表 {note.staff} · 声部{' '}
                {note.voice}
              </small>
            </div>
          </div>
          <div className="note-navigation">
            <button
              aria-label="上一音符"
              disabled={index <= 0}
              onClick={() => onSelect(ordered[index - 1].id)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {index + 1} / {ordered.length}
            </span>
            <button
              aria-label="下一音符"
              disabled={index < 0 || index >= ordered.length - 1}
              onClick={() => onSelect(ordered[index + 1].id)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">点击谱面音符或下方音符列表开始编辑。</p>
      )}
      <fieldset disabled={disabled || score.readonly}>
        <section className="inspector-section">
          <h3>音高</h3>
          <div className="form-row three">
            <label>
              音名
              <select
                aria-label="音名"
                value={step}
                onChange={(e) => setStep(e.target.value as Step)}
              >
                {STEPS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              变音
              <select
                aria-label="变音"
                value={alter}
                onChange={(e) => setAlter(Number(e.target.value))}
              >
                <option value={-2}>𝄫 重降</option>
                <option value={-1}>♭ 降</option>
                <option value={0}>♮ 还原</option>
                <option value={1}>♯ 升</option>
                <option value={2}>𝄪 重升</option>
              </select>
            </label>
            <label>
              八度
              <input
                aria-label="八度"
                type="number"
                min={0}
                max={9}
                value={octave}
                onChange={(e) => setOctave(Number(e.target.value))}
              />
            </label>
          </div>
          <button
            className="primary full"
            disabled={!note}
            onClick={() =>
              onCommand(
                (xml) => changePitch(xml, note!.id, pitch),
                '音高已更新',
              )
            }
          >
            应用音高 / 替换休止符
          </button>
          <div className="button-pair">
            <button
              disabled={!note}
              onClick={() =>
                onCommand(
                  (xml) => addChordTone(xml, note!.id, pitch),
                  '已添加和弦音',
                )
              }
            >
              <Plus size={14} />
              添加和弦音
            </button>
            <button
              disabled={!note}
              onClick={() =>
                onCommand((xml) => makeRest(xml, note!.id), '已改为休止符')
              }
            >
              改为休止符
            </button>
          </div>
        </section>
        <section className="inspector-section">
          <h3>时值</h3>
          <div className="form-row">
            <label>
              音符时值
              <select
                aria-label="音符时值"
                value={type}
                onChange={(e) => setType(e.target.value as NoteType)}
              >
                {(Object.keys(NOTE_TYPES) as NoteType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              附点
              <select
                aria-label="附点"
                value={dots}
                onChange={(e) => setDots(Number(e.target.value))}
              >
                <option value={0}>无</option>
                <option value={1}>单附点</option>
                <option value={2}>双附点</option>
              </select>
            </label>
          </div>
          <button
            className="full"
            disabled={!note}
            onClick={() =>
              onCommand(
                (xml) => changeRhythm(xml, note!.id, type, dots, ripple),
                ripple
                  ? '时值已更新；本小节同声部后续音符已顺移，其他声部保持原位'
                  : '和弦组时值已更新，其他音符起点保持原位',
              )
            }
          >
            应用时值
          </button>
          <label>
            时值修改方式
            <select
              aria-label="时值修改方式"
              value={ripple ? 'ripple' : 'fixed'}
              onChange={(e) => setRipple(e.target.value === 'ripple')}
            >
              <option value="fixed">保持其他音符起点</option>
              <option value="ripple">顺移本小节同声部后续音符</option>
            </select>
          </label>
          <p className="hint">
            {note &&
              `当前实际时长 ${Number(note.duration.toFixed(4))} 拍，起点 ${Number(note.onset.toFixed(4))} 拍（从 0 起）。`}
            以四分音符为 1
            拍。顺移仅作用于本小节所选谱表/声部，可用于修正误识的附点；其他声部与方向记号保持原位。
          </p>
          <div className="button-pair">
            <button
              disabled={!note}
              onClick={() =>
                onCommand(
                  (xml) => joinBeam(xml, note!.id),
                  '已与下一音连梁，音高与时值保持不变',
                )
              }
            >
              与下一音符连梁
            </button>
            <button
              disabled={!note}
              onClick={() =>
                onCommand(
                  (xml) => clearBeam(xml, note!.id),
                  '已清除当前手工连梁；未指定连梁的音符采用自动排版',
                )
              }
            >
              清除手工连梁
            </button>
          </div>
          <p className="hint">
            横梁连接的八分音符和带单独符尾的八分音符时值相同。可依次选择组内音符扩展连梁，导出保留手工分组。
          </p>
        </section>
        <section className="inspector-section">
          <h3>连线与删除</h3>
          <button
            className="full"
            disabled={!note}
            onClick={() =>
              onCommand((xml) => toggleTie(xml, note!.id), '延音线已更新')
            }
          >
            <Link2 size={14} />
            {note?.tieStart || note?.tieStop
              ? '解除延音线'
              : '与下一同音连接延音线'}
          </button>
          <div className="button-pair">
            <button
              disabled={!note}
              className={slurStart ? 'active' : ''}
              onClick={() => setSlurStart(note!.id)}
            >
              设为连奏线起点
            </button>
            <button
              disabled={!note || !slurStart}
              onClick={() => {
                onCommand(
                  (xml) => toggleSlur(xml, slurStart, note!.id),
                  '连奏线已更新',
                );
                setSlurStart('');
              }}
            >
              连接 / 解除终点
            </button>
          </div>
          {slurStart && (
            <p className="hint">
              起点已记住，请选择后方同声部音符再连接。再次选择同一对端点可解除。
            </p>
          )}
          <button
            className="full danger"
            disabled={!note}
            onClick={() =>
              onCommand(
                (xml) => deleteNote(xml, note!.id),
                '音符已删除；独立音符保留为等时值休止符',
              )
            }
          >
            删除当前音符
          </button>
        </section>
        <details className="inspector-section" open={insertOpen || undefined}>
          <summary>
            <Plus size={14} />
            插入到指定空拍 / 新声部
          </summary>
          <p className="hint">
            使用上方音高和时值。新声部可与左右手已有声部同时演奏。
          </p>
          <label>
            乐器
            <select
              aria-label="插入乐器"
              value={part}
              onChange={(e) => {
                setPart(Number(e.target.value));
                setMeasure(0);
              }}
            >
              {score.parts.map((p, i) => (
                <option key={p.id} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              小节
              <select
                aria-label="插入小节"
                value={measure}
                onChange={(e) => setMeasure(Number(e.target.value))}
              >
                {score.parts[part]?.measures.map((m) => (
                  <option key={m.id} value={m.index}>
                    {m.number}
                  </option>
                ))}
              </select>
            </label>
            <label>
              起点（从 0 拍）
              <input
                aria-label="插入起点"
                type="number"
                min={0}
                step={0.25}
                value={onset}
                onChange={(e) => setOnset(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              谱表
              <select
                aria-label="插入谱表"
                value={staff}
                onChange={(e) => setStaff(Number(e.target.value))}
              >
                {Array.from(
                  {
                    length:
                      score.parts[part]?.measures[measure]?.staffCount || 1,
                  },
                  (_, i) => (
                    <option key={i} value={i + 1}>
                      {i === 0 ? '1 · 右手' : i === 1 ? '2 · 左手' : i + 1}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              声部编号
              <input
                aria-label="插入声部"
                value={voice}
                maxLength={24}
                onChange={(e) => setVoice(e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={rest}
              onChange={(e) => setRest(e.target.checked)}
            />
            插入休止符
          </label>
          <button
            className="primary full"
            onClick={() =>
              onCommand(
                (xml) =>
                  insertNote(xml, {
                    ...pitch,
                    partIndex: part,
                    measureIndex: measure,
                    staff,
                    voice,
                    onset,
                    type,
                    dots,
                    rest,
                  }),
                '已插入音符',
              )
            }
          >
            插入到空拍
          </button>
        </details>
      </fieldset>
      {note && (
        <button
          disabled={disabled}
          className={`check-button full ${checked.includes(note.id) ? 'checked' : ''}`}
          onClick={() => onCheck(note.id)}
        >
          <Check size={16} />
          {checked.includes(note.id) ? '已校对 · 点击取消标记' : '标记已校对'}
        </button>
      )}
    </aside>
  );
}
