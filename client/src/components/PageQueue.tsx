import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  ArrowUp,
  ArrowDown,
  Download,
} from 'lucide-react';
import { pageXml, type ProjectPage } from '../storage/pages';

interface Props {
  pages: ProjectPage[];
  index: number;
  busy: boolean;
  canReorder: boolean;
  onSelect: (index: number) => void;
  onMove: (delta: number) => void;
  onAdd: () => void;
  onOpen: () => void;
  onDownload: () => void;
}
export default function PageQueue({
  pages,
  index,
  busy,
  canReorder,
  onSelect,
  onMove,
  onAdd,
  onOpen,
  onDownload,
}: Props) {
  const current = pages[index];
  if (!current) return null;
  const ready = !!pageXml(current),
    failed = !!current.error || current.recognition?.ok === false;
  return (
    <div className="page-queue" aria-label="原图页管理">
      <div className="page-nav">
        <button
          type="button"
          aria-label="上一页原图"
          disabled={index === 0 || busy}
          onClick={() => onSelect(index - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <select
          aria-label="原图页码"
          value={index}
          onChange={(e) => onSelect(Number(e.target.value))}
          disabled={busy}
        >
          {pages.map((p, i) => (
            <option key={p.id} value={i}>
              第 {i + 1} 页 / {pages.length} · {p.image.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="下一页原图"
          disabled={index === pages.length - 1 || busy}
          onClick={() => onSelect(index + 1)}
        >
          <ChevronRight size={15} />
        </button>
        <button
          type="button"
          className="page-add"
          onClick={onAdd}
          disabled={busy}
        >
          <ImagePlus size={14} />
          添加图片页
        </button>
      </div>
      <details className="page-actions" open={failed || undefined}>
        <summary>
          页序与结果 · {ready ? '已识别' : failed ? '识别失败' : '待识别'}
          {current.range &&
            ` · 小节 ${current.range.start + 1}–${current.range.start + current.range.count}`}
        </summary>
        {current.error && <p className="page-error">{current.error}</p>}
        <div className="page-action-buttons">
          <button
            type="button"
            aria-label="向前移动本页"
            disabled={!canReorder || index === 0 || busy}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={14} />
            前移
          </button>
          <button
            type="button"
            aria-label="向后移动本页"
            disabled={!canReorder || index === pages.length - 1 || busy}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={14} />
            后移
          </button>
          <button type="button" disabled={!ready || busy} onClick={onOpen}>
            打开本页乐谱
          </button>
          <button
            type="button"
            disabled={
              typeof current.recognition?.musicXml !== 'string' ||
              !current.recognition.musicXml
            }
            onClick={onDownload}
          >
            <Download size={13} />
            下载本页 XML
          </button>
        </div>
        {pages.length > 1 && (
          <p className="hint">
            {canReorder
              ? '按页序识别并合成一首曲子。'
              : '已合谱的页序固定；原始识谱项目仍可重新排序并合成副本。'}
          </p>
        )}
      </details>
    </div>
  );
}
