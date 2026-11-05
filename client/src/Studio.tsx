import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Music2,
  FolderOpen,
  ScanLine,
  Settings2,
  Plus,
  Upload,
  FileMusic,
  Undo2,
  Redo2,
  Download,
  Play,
  Pause,
  Square,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  X,
  Columns2,
  Code2,
  Music,
  ImagePlus,
  ZoomIn,
  ZoomOut,
  Save,
  ChevronRight,
} from 'lucide-react';
import ScoreView from './components/ScoreView';
import NoteInspector from './components/NoteInspector';
import { parseScore, noteLabel } from './music/score';
import { appendMeasure, createPianoScore, deleteNote } from './music/editor';
import {
  createHistory,
  pushHistory,
  undo,
  redo,
  type History,
} from './music/history';
import { buildTimeline, beatToSeconds } from './music/timeline';
import { MusicPlayer } from './music/player';
import { createMidi } from './music/midi';
import {
  importScoreFile,
  download,
  exportMxl,
  fromBase64,
  imageDataUrl,
} from './storage/files';
import {
  newProject,
  parseProject,
  listProjects,
  saveProject,
  type StudioProject,
} from './storage/projects';
import {
  OmrRecognizer,
  checkModels,
  probeOmrRuntime,
  OMR_ERRORS,
  type ModelStatus,
  type Progress,
} from './omr/recognizer';
import { SAMPLE_MUSICXML } from './utils/sampleMusicXml';
type View = 'score' | 'compare' | 'xml';
const STAGES: Record<string, string> = {
  models: '下载并校验模型',
  segment: '图像分割',
  detect: '音符检测',
  dewarp: '谱线校正',
  staff: '五线谱识别',
  ocr: '文字识别',
  xml: '生成 MusicXML',
  tab: '指法谱检查',
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function Studio() {
  const [project, setProject] = useState<StudioProject | null>(null);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [screen, setScreen] = useState<'workbench' | 'library' | 'settings'>(
    'workbench',
  );
  const [view, setView] = useState<View>('score');
  const [selected, setSelected] = useState('');
  const [zoom, setZoom] = useState(1),
    [imageZoom, setImageZoom] = useState(1);
  const [insertOpen, setInsertOpen] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState('未打开项目');
  const [playing, setPlaying] = useState(false),
    [beat, setBeat] = useState(0),
    [tempo, setTempo] = useState(120),
    [volume, setVolume] = useState(0.6);
  const [approximate, setApproximate] = useState(false);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Progress | null>(null);
  const [statuses, setStatuses] = useState<ModelStatus[] | null>(null),
    [checking, setChecking] = useState(false);
  const [focusedBox, setFocusedBox] = useState(-1);
  const [runtime, setRuntime] = useState(''),
    [probing, setProbing] = useState(false);
  const [tempoDraft, setTempoDraft] = useState('120');
  const fileInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const player = useRef<MusicPlayer | null>(null),
    omr = useRef(new OmrRecognizer()),
    controller = useRef<AbortController | null>(null);
  const active = useRef(project);
  active.current = project;
  useEffect(() => setTempoDraft(String(tempo)), [tempo]);
  const score = useMemo(
    () => (project?.xml ? parseScore(project.xml) : null),
    [project?.xml],
  );
  const timeline = useMemo(
    () => (score && !score.readonly ? buildTimeline(score) : null),
    [score],
  );
  const note = score?.notes.find((n) => n.id === selected);
  const image = project?.image;
  const staves = useMemo(() => {
    const value = project?.recognition?.staves;
    return Array.isArray(value)
      ? value.filter(
          (b: unknown): b is { cx: number; cy: number; w: number; h: number } =>
            !!b &&
            typeof b === 'object' &&
            ['cx', 'cy', 'w', 'h'].every(
              (k) => typeof (b as Record<string, unknown>)[k] === 'number',
            ),
        )
      : [];
  }, [project?.recognition]);
  const fail = useCallback((e: unknown) => {
    setError(message(e));
    setNotice('');
  }, []);
  const stop = useCallback(() => {
    player.current?.stop();
    setPlaying(false);
    setBeat(0);
  }, []);
  const load = useCallback(
    (p: StudioProject) => {
      stop();
      active.current = p;
      setProject(p);
      setHistory(createHistory(p.xml));
      setSelected(p.xml ? parseScore(p.xml).notes[0]?.id || '' : '');
      setView(p.image ? 'compare' : 'score');
      setScreen('workbench');
      setError('');
      setNotice('');
      setApproximate(false);
      setInsertOpen(false);
    },
    [stop],
  );
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((list) => {
        if (!cancelled) {
          setProjects((current) => [
            ...current,
            ...list.filter((p) => !current.some((c) => c.id === p.id)),
          ]);
          if (!active.current && list[0]) load(list[0]);
        }
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [load, fail]);
  useEffect(() => {
    if (!project) return;
    setSaveState('等待保存');
    setProjects((items) =>
      [project, ...items.filter((p) => p.id !== project.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
    const timer = setTimeout(() => {
      setSaveState('保存中');
      saveProject(project)
        .then(() => {
          if (
            active.current?.id === project.id &&
            active.current.updatedAt === project.updatedAt
          )
            setSaveState('已保存到此浏览器');
        })
        .catch((e) => {
          setSaveState('保存失败');
          fail(`浏览器保存失败：${message(e)}。请立即下载项目备份。`);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [project, fail]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (project && saveState !== '已保存到此浏览器') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [project, saveState]);
  useEffect(() => {
    if (!timeline) {
      stop();
      return;
    }
    player.current ??= new MusicPlayer();
    player.current.loadMusic(timeline);
    const initialTempo = timeline.tempos[0]?.bpm || 120;
    setTempo(initialTempo);
    setPlaying(false);
    setBeat(0);
    player.current.setOptions({
      tempo: initialTempo,
      volume,
      onProgress: (beat) => setBeat(beat),
      onEnd: () => setPlaying(false),
    });
    return () => player.current?.stop();
    // Volume has its own live control; changing it must not reload the score.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, stop]);
  useEffect(
    () => () => {
      controller.current?.abort();
      void player.current?.dispose();
      void omr.current.dispose();
    },
    [],
  );
  const update = (patch: Partial<StudioProject>) => {
    setProject((current) =>
      current
        ? {
            ...current,
            ...patch,
            updatedAt: Math.max(Date.now(), current.updatedAt + 1),
          }
        : current,
    );
  };
  async function activate(p: StudioProject) {
    if (busy) return false;
    try {
      if (active.current) await saveProject(active.current);
      load(p);
      return true;
    } catch (e) {
      fail(`切换前保存失败：${message(e)}。请先下载当前项目。`);
      return false;
    }
  }
  function applyXml(xml: string, nextHistory?: History) {
    if (!project) return;
    const parsed = parseScore(xml);
    const previous = score?.notes || [];
    const sameCount = previous.length === parsed.notes.length;
    const serializer = new XMLSerializer();
    const checked = sameCount
      ? project.checked.filter((id) => {
          const a = previous.find((n) => n.id === id),
            b = parsed.notes.find((n) => n.id === id);
          return (
            a &&
            b &&
            serializer.serializeToString(a.element) ===
              serializer.serializeToString(b.element)
          );
        })
      : [];
    update({ xml, draft: xml, checked });
    setHistory(
      nextHistory || pushHistory(history || createHistory(project.xml), xml),
    );
    if (!parsed.notes.some((n) => n.id === selected))
      setSelected(parsed.notes[0]?.id || '');
    setError('');
  }
  function command(action: (xml: string) => string, success: string) {
    if (!project || busy) return;
    try {
      applyXml(action(project.xml));
      setNotice(success);
    } catch (e) {
      fail(e);
    }
  }
  const travel = (direction: 'undo' | 'redo') => {
    if (history) {
      const next = direction === 'undo' ? undo(history) : redo(history);
      try {
        applyXml(next.present, next);
        setNotice(direction === 'undo' ? '已撤销' : '已重做');
      } catch (e) {
        fail(e);
      }
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        busy ||
        (e.target instanceof HTMLElement &&
          (e.target.matches('input, textarea, select') ||
            e.target.isContentEditable))
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        travel(e.shiftKey ? 'redo' : 'undo');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        travel('redo');
      }
      if (e.key === 'Delete' && selected) {
        e.preventDefault();
        command((xml) => deleteNote(xml, selected), '已删除音符，时位保持不变');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  async function importFile(file: File) {
    if (busy) return;
    try {
      if (/\.studio\.json$/i.test(file.name) || file.name.endsWith('.json')) {
        if (await activate(parseProject(await file.text())))
          setNotice('项目已导入为独立副本');
        return;
      }
      if (!/\.(xml|musicxml|mxl)$/i.test(file.name))
        throw new Error(
          '请导入 MusicXML、XML、MXL 或 .studio.json 项目；PDF/图片请先转换或使用图片识谱',
        );
      const source = await importScoreFile(file),
        p = newProject(source.xml);
      p.source = source;
      if (await activate(p))
        setNotice(
          ['乐谱已导入，原始文件已保留', ...source.warnings].join('。'),
        );
    } catch (e) {
      fail(e);
    }
  }
  async function uploadImage(file: File) {
    if (busy) return;
    try {
      const targetId = active.current?.id;
      const dataUrl = await imageDataUrl(file);
      if (active.current?.id !== targetId)
        throw new Error('图片读取期间项目已切换，请重新选择图片');
      if (project)
        update({ image: { name: file.name, dataUrl }, recognition: undefined });
      else if (
        !(await activate({
          ...newProject('', file.name.replace(/\.[^.]+$/, '')),
          image: { name: file.name, dataUrl },
        }))
      )
        return;
      setView('compare');
      setScreen('workbench');
      setNotice('原图已保存。可识别为新项目，或与现有谱面并排校对。');
      setError('');
    } catch (e) {
      fail(e);
    }
  }
  async function recognize() {
    if (!project?.image || busy) return;
    const original = project;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setProgress({ stage: 'models', done: 0, total: 0 });
    try {
      await saveProject(original);
      const blob = await (await fetch(original.image!.dataUrl)).blob();
      const result = await omr.current.recognize(
        blob,
        (p) => {
          if (!abort.signal.aborted) setProgress(p);
        },
        abort.signal,
      );
      abort.signal.throwIfAborted();
      if (!result.ok) {
        update({ recognition: JSON.parse(JSON.stringify(result)) });
        throw new Error(
          `${OMR_ERRORS[result.error] || result.error}${result.log ? `：${result.log}` : ''}`,
        );
      }
      parseScore(result.musicXml);
      const p = {
        ...newProject(result.musicXml),
        image: original.image,
        recognition: JSON.parse(JSON.stringify(result)),
      };
      load(p);
      setView('compare');
      setNotice(
        '识别结果已建立为新项目。原图已保留，请逐音符校对；识别结果不代表已核验正确。',
      );
    } catch (e) {
      if (abort.signal.aborted) setNotice('识别已取消，原图与现有谱面已保留');
      else fail(e);
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
        setProgress(null);
      }
    }
  }
  async function inspectModels() {
    setChecking(true);
    try {
      setStatuses(await checkModels());
    } catch (e) {
      fail(e);
    } finally {
      setChecking(false);
    }
  }
  async function inspectRuntime() {
    setProbing(true);
    setRuntime('');
    try {
      const result = await probeOmrRuntime();
      setRuntime(
        `运行时已就绪：${result.backend}，${result.threads} 线程。${result.reason}`,
      );
    } catch (e) {
      fail(`运行时初始化失败：${message(e)}`);
    } finally {
      setProbing(false);
    }
  }
  async function playPause() {
    if (!timeline || !player.current) return;
    try {
      if (playing) {
        player.current.pause();
        setPlaying(false);
      } else {
        await player.current.play(player.current.getCurrentTime(), approximate);
        setPlaying(player.current.getIsPlaying());
      }
    } catch (e) {
      fail(e);
    }
  }
  const playbackBlocked = !!timeline?.issues.length && !approximate;
  const name = project?.title || '未命名乐谱';
  function exportFile(kind: 'xml' | 'mxl' | 'midi' | 'project' | 'original') {
    if (!project) return;
    if (exportMenu.current) exportMenu.current.open = false;
    try {
      if (kind === 'project')
        download(
          JSON.stringify(project, null, 2),
          `${name}.studio.json`,
          'application/json',
        );
      if (kind === 'xml') {
        download(
          project.xml,
          `${name}.musicxml`,
          'application/vnd.recordare.musicxml+xml',
        );
        if (project.source?.archive)
          setNotice(
            '已导出主 XML。若需要压缩谱中的附件，请同时导出 MXL 或项目文件。',
          );
      }
      if (kind === 'mxl')
        download(
          exportMxl(project.xml, project.source?.archive),
          `${name}.mxl`,
          'application/vnd.recordare.musicxml',
        );
      if (kind === 'midi' && timeline)
        download(
          createMidi(
            timeline,
            approximate,
            tempo / (timeline.tempos[0]?.bpm || 120),
          ),
          `${name}.mid`,
          'audio/midi',
        );
      if (kind === 'original') {
        if (project.source)
          download(
            fromBase64(project.source.originalData),
            project.source.sourceName,
          );
        else
          download(
            project.originalXml,
            `${name}-原始.musicxml`,
            'application/xml',
          );
      }
    } catch (e) {
      fail(e);
    }
  }
  const createNew = () => void activate(newProject(createPianoScore()));
  const sample = () => {
    void activate(newProject(SAMPLE_MUSICXML, '小星星 · 示例乐谱'));
  };
  const picker = (kind: 'file' | 'image') =>
    (kind === 'file' ? fileInput : imageInput).current?.click();

  return (
    <div
      className="studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) {
          if (file.type.startsWith('image/')) void uploadImage(file);
          else void importFile(file);
        }
      }}
    >
      <input
        data-testid="score-file-input"
        ref={fileInput}
        hidden
        type="file"
        accept=".xml,.musicxml,.mxl,.json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />
      <input
        data-testid="image-file-input"
        ref={imageInput}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void uploadImage(f);
        }}
      />
      <header className="app-header">
        <button
          disabled={busy}
          className="brand"
          aria-label="谱写 Studio 首页"
          onClick={() => setScreen('library')}
        >
          <span className="brand-mark">
            <Music2 size={23} />
          </span>
          <strong>
            谱写
            <span>
              STUDIO <b>2.0</b>
            </span>
          </strong>
        </button>
        <span className="header-divider" />
        <div className="project-heading">
          {project ? (
            <>
              <input
                aria-label="项目名称"
                value={project.title}
                onChange={(e) => update({ title: e.target.value })}
                disabled={busy}
              />
              <span className="save-status">
                <span
                  className={
                    saveState === '保存失败'
                      ? 'status-dot failed'
                      : 'status-dot'
                  }
                />
                {saveState}
              </span>
            </>
          ) : (
            <>
              <strong>每一个音符，都值得认真书写。</strong>
              <span className="save-status">
                本地编辑 · 本地识谱 · MusicXML 保留
              </span>
            </>
          )}
        </div>
        <div className="header-actions">
          <button onClick={createNew} disabled={busy}>
            <Plus size={16} />
            新建钢琴谱
          </button>
          <button onClick={() => picker('file')} disabled={busy}>
            <Upload size={16} />
            导入乐谱
          </button>
          {project && (
            <details ref={exportMenu} className="export-menu">
              <summary>
                <Download size={16} />
                导出
                <ChevronDown size={14} />
              </summary>
              <div className="menu-popover">
                <button
                  disabled={!project.xml}
                  onClick={() => exportFile('xml')}
                >
                  导出 MusicXML
                </button>
                <button
                  disabled={!project.xml}
                  onClick={() => exportFile('mxl')}
                >
                  导出 MXL（含附件）
                </button>
                <button
                  disabled={!timeline || playbackBlocked}
                  onClick={() => exportFile('midi')}
                >
                  导出 MIDI
                </button>
                <button onClick={() => exportFile('project')}>
                  下载项目备份
                </button>
                <button
                  disabled={!project.originalXml && !project.source}
                  onClick={() => exportFile('original')}
                >
                  下载原始乐谱
                </button>
              </div>
            </details>
          )}
        </div>
      </header>
      <div className="body-layout">
        <nav className="rail" aria-label="主导航">
          <button
            className={screen === 'library' ? 'active' : ''}
            disabled={busy}
            aria-label="项目库"
            title="项目库"
            onClick={() => setScreen('library')}
          >
            <FolderOpen />
            <span>项目</span>
          </button>
          <button
            className={screen === 'workbench' ? 'active' : ''}
            aria-label="编辑工作台"
            title="编辑工作台"
            onClick={() => setScreen('workbench')}
          >
            <Music2 />
            <span>编辑</span>
          </button>
          <button
            aria-label="图片识谱"
            title="上传原图"
            onClick={() => picker('image')}
            disabled={busy}
          >
            <ScanLine />
            <span>识谱</span>
          </button>
          <button
            className={`rail-settings ${screen === 'settings' ? 'active' : ''}`}
            disabled={busy}
            aria-label="引擎与模型设置"
            onClick={() => {
              setScreen('settings');
              if (!statuses) void inspectModels();
            }}
          >
            <Settings2 />
            <span>设置</span>
          </button>
        </nav>
        <div className="main-shell">
          {(error || notice) && (
            <div
              className={`notice ${error ? 'error' : 'info'}`}
              role={error ? 'alert' : 'status'}
            >
              {error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
              <span>{error || notice}</span>
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setError('');
                  setNotice('');
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {screen === 'settings' ? (
            <main className="settings-page">
              <div className="page-intro">
                <span className="eyebrow">RECOGNITION ENGINE</span>
                <h1>识谱引擎与模型</h1>
                <p>homr-web 0.5.4 · WebAssembly · 浏览器本地计算</p>
              </div>
              <div className="settings-card">
                <h2>运行环境</h2>
                <p>初始化实际 Worker、OpenCV 与 ONNX，不加载识谱模型。</p>
                <button
                  onClick={() => void inspectRuntime()}
                  disabled={probing || busy}
                >
                  {probing ? '初始化中…' : '检查引擎运行时'}
                </button>
                {runtime && (
                  <p role="status" className="runtime-status">
                    {runtime}
                  </p>
                )}
                <h2 style={{ marginTop: 24 }}>模型可用性</h2>
                <p>
                  需要 7 个 WASM 模型，约 190
                  MB。模型不包含在原始源码包中。缺失或错误文件会阻止识别。
                </p>
                <button
                  onClick={() => void inspectModels()}
                  disabled={checking}
                >
                  {checking ? '检查中…' : '重新检查模型'}
                </button>
                {statuses && (
                  <ul className="model-list">
                    {statuses.map((s) => (
                      <li key={s.id}>
                        <span
                          className={`status-dot ${s.available ? '' : 'failed'}`}
                        />
                        <strong>{s.id}</strong>
                        <span>
                          {s.available ? '可访问，加载时验哈希' : s.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>安装与验证</h3>
                <p>
                  在项目根目录运行以下命令，下载器会核验文件大小与 SHA-256：
                </p>
                <pre>npm run models:download{'\n'}npm run models:check</pre>
                <p className="muted small">
                  模型存放在
                  client/public/models/&lt;sha256&gt;/&lt;filename&gt;。若
                  GitHub
                  无法访问，可在另一台设备下载同版本发布资源并按清单路径复制。源码清单位于
                  client/src/omr/models.json。
                </p>
                <p className="small">
                  支持 PNG、JPEG、WebP；PDF、TIFF、HEIC
                  请先转换。多页乐谱目前逐页识别。首次初始化需加载 OpenCV 与
                  ONNX WASM，单线程速度取决于设备。
                </p>
                <a
                  href="https://github.com/jymen/homr-web"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看引擎文档与模型来源 ↗
                </a>
              </div>
            </main>
          ) : screen === 'library' ? (
            <main className="library-page">
              <div className="page-intro">
                <span className="eyebrow">YOUR MUSIC LIBRARY</span>
                <h1>你的乐谱项目</h1>
                <p>
                  原图、原始谱、编辑稿与校对标记一起保存在此浏览器。下载项目文件可备份或迁移。
                </p>
              </div>
              <div className="library-actions">
                <button className="primary" onClick={createNew} disabled={busy}>
                  <Plus size={16} />
                  新建钢琴谱
                </button>
                <button onClick={() => picker('file')} disabled={busy}>
                  导入 MusicXML / MXL / 项目
                </button>
              </div>
              <div className="project-grid">
                {projects.map((p) => (
                  <button
                    className="project-card"
                    key={p.id}
                    onClick={() => void activate(p)}
                    disabled={busy}
                  >
                    <div className="project-preview">
                      {p.image ? (
                        <img src={p.image.dataUrl} alt="" />
                      ) : (
                        <Music2 size={52} />
                      )}
                    </div>
                    <strong>{p.title}</strong>
                    <span>
                      {p.xml ? 'MusicXML 乐谱' : '待识别原图'} ·{' '}
                      {new Date(p.updatedAt).toLocaleString('zh-CN')}
                    </span>
                    <small>
                      打开项目 <ChevronRight size={13} />
                    </small>
                  </button>
                ))}
                {!projects.length && (
                  <p className="muted">
                    还没有项目。新建一份乐谱，或导入你的作品。
                  </p>
                )}
              </div>
            </main>
          ) : !project ? (
            <main className="welcome">
              <div className="welcome-copy">
                <span className="eyebrow">A WORKSPACE FOR EVERY NOTE</span>
                <h1>
                  从一张乐谱，
                  <br />
                  到你的钢琴作品。
                </h1>
                <p>
                  书写双手钢琴谱，校对图片识谱结果。
                  <br />
                  在同一张工作台上，听见每一次修改。
                </p>
                <div className="welcome-actions">
                  <button className="primary" onClick={createNew}>
                    <Plus size={18} />
                    新建钢琴谱
                  </button>
                  <button onClick={sample}>
                    <Play size={17} />
                    加载示例乐谱
                  </button>
                </div>
                <div className="import-options">
                  <button onClick={() => picker('file')}>
                    <FileMusic size={20} />
                    <span>
                      导入 MusicXML / MXL
                      <small>保留复杂谱面信息与原始文件</small>
                    </span>
                  </button>
                  <button onClick={() => picker('image')}>
                    <ScanLine size={20} />
                    <span>
                      上传乐谱图片<small>识别 · 并排校对 · 逐音符修正</small>
                    </span>
                  </button>
                </div>
                <span className="privacy-note">
                  <CheckCircle2 size={14} />
                  项目留在你的浏览器，可随时下载备份
                </span>
              </div>
              <div className="welcome-score" aria-hidden="true">
                <span className="eyebrow">PIANO · GRAND STAFF</span>
                <h2>Prelude to an idea</h2>
                <p>给灵感，一个开始。</p>
                <svg viewBox="0 0 480 300">
                  <g stroke="#aebbb7" strokeWidth="1">
                    {[70, 82, 94, 106, 118, 188, 200, 212, 224, 236].map(
                      (y) => (
                        <line key={y} x1="32" y1={y} x2="450" y2={y} />
                      ),
                    )}
                    {[32, 240, 450].map((x) => (
                      <g key={x}>
                        <line x1={x} y1="70" x2={x} y2="118" />
                        <line x1={x} y1="188" x2={x} y2="236" />
                      </g>
                    ))}
                  </g>
                  <g fill="#314b43">
                    <text x="42" y="114" fontSize="64" fontFamily="serif">
                      𝄞
                    </text>
                    <text x="44" y="230" fontSize="55" fontFamily="serif">
                      𝄢
                    </text>
                    {[
                      [125, 106],
                      [177, 94],
                      [285, 82],
                      [340, 94],
                      [396, 106],
                      [125, 224],
                      [125, 200],
                      [285, 212],
                      [285, 188],
                    ].map(([x, y], i) => (
                      <g key={i}>
                        <ellipse
                          cx={x}
                          cy={y}
                          rx="8"
                          ry="5.8"
                          transform={`rotate(-18 ${x} ${y})`}
                        />
                        <path
                          d={`M${x + 7} ${y}v-35`}
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                      </g>
                    ))}
                  </g>
                  <path
                    d="M124 70 Q192 30 287 48"
                    fill="none"
                    stroke="#507e6b"
                    strokeWidth="1.5"
                  />
                </svg>
                <div className="score-card-label">
                  <span>01</span>一份谱面，完整的表达。
                  <Music size={18} />
                </div>
              </div>
            </main>
          ) : (
            <div
              className={`workspace ${view === 'compare' ? 'is-comparing' : ''}`}
            >
              <aside className="resource-panel">
                <div className="panel-heading">
                  <h2>乐谱资源</h2>
                  <button
                    aria-label="上传校对原图"
                    title="上传校对原图"
                    onClick={() => picker('image')}
                    disabled={busy}
                  >
                    <ImagePlus size={16} />
                  </button>
                </div>
                <button
                  className="source-card"
                  onClick={() => picker('image')}
                  disabled={busy}
                >
                  {image ? (
                    <>
                      <img src={image.dataUrl} alt="原图缩略图" />
                      <span>{image.name}</span>
                    </>
                  ) : (
                    <>
                      <ScanLine size={30} />
                      <span>添加校对原图</span>
                      <small>PNG · JPEG · WebP</small>
                    </>
                  )}
                </button>
                {image && (
                  <>
                    <button
                      className="primary full"
                      onClick={() => void recognize()}
                      disabled={busy}
                    >
                      <ScanLine size={15} />
                      识别为新项目
                    </button>
                    <p className="hint">保留当前项目，识别后在新项目中校对。</p>
                  </>
                )}
                <div className="resource-section">
                  <h3>
                    小节导航{' '}
                    <span>{score?.parts[0]?.measures.length || 0}</span>
                  </h3>
                  <div className="measure-grid">
                    {score?.parts[0]?.measures.map((m) => (
                      <button
                        key={m.id}
                        className={
                          note?.measureIndex === m.index ? 'active' : ''
                        }
                        onClick={() => {
                          const target = score.notes.find(
                            (n) => n.measureIndex === m.index,
                          );
                          if (target) setSelected(target.id);
                        }}
                      >
                        {m.number}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="resource-section">
                  <h3>乐器与声部</h3>
                  {score?.parts.map((p) => (
                    <div key={p.id} className="part-item">
                      <span className="status-dot" />
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {Math.max(1, ...p.measures.map((m) => m.staffCount))}{' '}
                          谱表 ·{' '}
                          {
                            new Set(
                              p.measures.flatMap((m) =>
                                m.notes.map((n) => n.voice),
                              ),
                            ).size
                          }{' '}
                          声部
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="resource-footer">
                  <Save size={14} />
                  <p>
                    定期下载项目备份。浏览器清理数据后，本地项目可能不可恢复。
                  </p>
                  <button onClick={() => exportFile('project')}>
                    下载项目备份
                  </button>
                </div>
              </aside>
              <main className="editor-main">
                <div className="editor-toolbar">
                  <div className="button-pair history-buttons">
                    <button
                      aria-label="撤销"
                      title="撤销 Ctrl+Z"
                      disabled={!history?.past.length || busy}
                      onClick={() => travel('undo')}
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      aria-label="重做"
                      title="重做 Ctrl+Shift+Z"
                      disabled={!history?.future.length || busy}
                      onClick={() => travel('redo')}
                    >
                      <Redo2 size={17} />
                    </button>
                  </div>
                  <span className="toolbar-divider" />
                  <button
                    disabled={!score || score.readonly || busy}
                    onClick={() =>
                      command(appendMeasure, '已为所有乐器新增小节')
                    }
                  >
                    <Plus size={15} />
                    新增小节
                  </button>
                  <button
                    disabled={!score || score.readonly || busy}
                    onClick={() => setInsertOpen((v) => !v)}
                  >
                    插入音符
                  </button>
                  <div className="zoom-control">
                    <button
                      aria-label="缩小谱面"
                      disabled={zoom <= 0.5}
                      onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
                    >
                      <ZoomOut size={15} />
                    </button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button
                      aria-label="放大谱面"
                      disabled={zoom >= 2}
                      onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
                    >
                      <ZoomIn size={15} />
                    </button>
                  </div>
                </div>
                <div
                  className="editor-tabs"
                  role="tablist"
                  aria-label="编辑视图"
                >
                  {(
                    [
                      ['score', '五线谱', Music],
                      ['compare', '并排校对', Columns2],
                      ['xml', 'XML 源码', Code2],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={view === key}
                      className={view === key ? 'active' : ''}
                      onClick={() => setView(key)}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                  <span className="score-stats">
                    {score
                      ? `${score.notes.length} 个记谱音符 · ${score.duration.toFixed(1)} 拍`
                      : '等待识别或导入'}
                  </span>
                </div>
                {busy && (
                  <div className="recognition-progress" role="status">
                    <span className="spinner" />
                    <div>
                      <strong>
                        {STAGES[progress?.stage || 'models'] || progress?.stage}
                      </strong>
                      <progress
                        value={
                          progress?.total
                            ? progress.done / progress.total
                            : undefined
                        }
                        max={1}
                      />
                      <small>
                        {progress?.total
                          ? `${Math.round((progress.done / progress.total) * 100)}% · 当前阶段`
                          : '正在准备识谱环境…'}
                      </small>
                    </div>
                    <button onClick={() => controller.current?.abort()}>
                      取消识别
                    </button>
                  </div>
                )}
                {!!score?.warnings.length && (
                  <details className="fidelity-notice">
                    <summary>
                      <AlertTriangle size={14} />
                      乐谱提示（{score.warnings.length}）· XML 信息保留
                    </summary>
                    <ul>
                      {score.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {timeline && !!timeline.issues.length && (
                  <details className="fidelity-notice" open>
                    <summary>
                      <AlertTriangle size={14} />
                      试听 / MIDI 存在解释限制
                    </summary>
                    <ul>
                      {timeline.issues.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={approximate}
                        onChange={(e) => {
                          stop();
                          setApproximate(e.target.checked);
                        }}
                      />
                      <span>我已了解，按上述近似方式试听与导出 MIDI</span>
                    </label>
                  </details>
                )}
                {view === 'xml' ? (
                  <div className="xml-panel">
                    <div>
                      <p>
                        直接编辑原始
                        MusicXML。语法错误不会覆盖已应用乐谱；未应用草稿随项目保存。
                      </p>
                      <button
                        className="primary"
                        disabled={busy || project.draft === project.xml}
                        onClick={() =>
                          command(() => project.draft, 'XML 变更已验证并应用')
                        }
                      >
                        应用 XML 修改
                      </button>
                      <button
                        disabled={busy || project.draft === project.xml}
                        onClick={() => update({ draft: project.xml })}
                      >
                        恢复已应用版本
                      </button>
                    </div>
                    <textarea
                      aria-label="MusicXML 源码"
                      spellCheck={false}
                      value={project.draft}
                      onChange={(e) => update({ draft: e.target.value })}
                      disabled={busy}
                    />
                  </div>
                ) : (
                  <div
                    className={`canvas-area ${view === 'compare' ? 'comparison' : ''}`}
                  >
                    {view === 'compare' && (
                      <section
                        className="original-pane"
                        aria-label="原图校对区"
                      >
                        <div className="canvas-heading">
                          <span>原始图片</span>
                          {image && (
                            <button
                              className="recognize-inline"
                              disabled={busy}
                              onClick={() => void recognize()}
                            >
                              <ScanLine size={13} />
                              识别为新项目
                            </button>
                          )}
                          <div>
                            <button
                              aria-label="缩小原图"
                              onClick={() =>
                                setImageZoom((z) => Math.max(0.5, z - 0.25))
                              }
                            >
                              −
                            </button>
                            <span>{Math.round(imageZoom * 100)}%</span>
                            <button
                              aria-label="放大原图"
                              onClick={() =>
                                setImageZoom((z) => Math.min(4, z + 0.25))
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <div className="image-viewport">
                          {image ? (
                            <div
                              className="image-scale"
                              style={{ width: `${imageZoom * 100}%` }}
                            >
                              <img src={image.dataUrl} alt="乐谱原图" />
                              {staves.map((box, i) => (
                                <button
                                  key={i}
                                  aria-label={`原图谱行 ${i + 1}`}
                                  className={`staff-box ${focusedBox === i ? 'focused' : ''}`}
                                  style={{
                                    left: `${(box.cx - box.w / 2) * 100}%`,
                                    top: `${(box.cy - box.h / 2) * 100}%`,
                                    width: `${box.w * 100}%`,
                                    height: `${box.h * 100}%`,
                                  }}
                                  onClick={() => setFocusedBox(i)}
                                />
                              ))}
                            </div>
                          ) : (
                            <button
                              className="empty-original"
                              onClick={() => picker('image')}
                            >
                              <ImagePlus size={34} />
                              <strong>添加原图开始校对</strong>
                              <span>与已有乐谱并排查看</span>
                            </button>
                          )}
                        </div>
                        <p className="canvas-hint">
                          1. 放大原图查看谱行 → 2. 选择右侧音符 → 3.
                          修正并标记已校对
                        </p>
                      </section>
                    )}
                    <section className="score-pane" aria-label="乐谱编辑区">
                      <div className="canvas-heading">
                        <span>
                          {view === 'compare' ? '识别 / 编辑谱面' : '钢琴总谱'}
                        </span>
                        <span>
                          {project.checked.length} / {score?.notes.length || 0}{' '}
                          已校对
                        </span>
                      </div>
                      <div className="score-scroll">
                        {score ? (
                          <ScoreView
                            score={score}
                            zoom={zoom}
                            selected={selected}
                            beat={playing ? beat : null}
                            checked={project.checked}
                            onSelect={setSelected}
                          />
                        ) : (
                          <div className="empty-score">
                            <Music2 size={45} />
                            <h2>谱面将在这里展开</h2>
                            <p>
                              点击「识别为新项目」，或导入 MusicXML 开始校对。
                            </p>
                            <button onClick={() => picker('file')}>
                              导入乐谱
                            </button>
                            <button onClick={createNew}>新建钢琴谱</button>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                )}
                {score && !score.readonly && (
                  <div className="note-ledger">
                    <div>
                      <strong>逐音符校对</strong>
                      <span>
                        可使用属性面板的前后按钮。和弦中的每个音可独立选择。
                      </span>
                    </div>
                    <div className="note-strip">
                      {score.notes.map((n) => (
                        <button
                          key={n.id}
                          className={`${selected === n.id ? 'active' : ''} ${project.checked.includes(n.id) ? 'checked' : ''}`}
                          aria-label={`选择 ${noteLabel(n)} 小节${n.measureIndex + 1} 谱表${n.staff} 声部${n.voice} 第${n.noteIndex + 1}音`}
                          onClick={() => setSelected(n.id)}
                        >
                          <small>
                            {n.measureIndex + 1}:
                            {Number((n.onset + 1).toFixed(3))} ·{' '}
                            {n.staff === 1
                              ? 'R'
                              : n.staff === 2
                                ? 'L'
                                : n.staff}
                            v{n.voice}
                          </small>
                          <strong>
                            {noteLabel(n)}
                            {n.chord ? ' ◇' : ''}
                          </strong>
                          {project.checked.includes(n.id) && (
                            <CheckCircle2 size={11} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </main>
              {score && (
                <NoteInspector
                  key={project.id}
                  score={score}
                  note={note}
                  disabled={busy}
                  checked={project.checked}
                  insertOpen={insertOpen}
                  onSelect={setSelected}
                  onCommand={command}
                  onCheck={(id) =>
                    update({
                      checked: project.checked.includes(id)
                        ? project.checked.filter((x) => x !== id)
                        : [...project.checked, id],
                    })
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
      <footer className="transport">
        <div className="transport-info">
          <span className="transport-icon">
            <Music2 size={18} />
          </span>
          <div>
            <strong>{name}</strong>
            <small>
              {timeline ? '钢琴合成音色 · 声部并行' : '准备好，写下第一个音符'}
            </small>
          </div>
        </div>
        <div className="transport-controls">
          <button
            aria-label={playing ? '暂停' : '播放'}
            className="play-button"
            disabled={!timeline?.notes.length || playbackBlocked || busy}
            onClick={() => void playPause()}
          >
            {playing ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <button aria-label="停止" disabled={!timeline} onClick={stop}>
            <Square size={15} />
          </button>
          <span className="time-code">
            {time(
              timeline
                ? beatToSeconds(beat, timeline.tempos) /
                    (tempo / (timeline.tempos[0]?.bpm || 120))
                : 0,
            )}
          </span>
          <input
            aria-label="播放进度"
            type="range"
            min={0}
            max={timeline?.duration || 1}
            step={0.01}
            value={beat}
            disabled={!timeline || playbackBlocked}
            onChange={(e) => {
              const value = Number(e.target.value);
              setBeat(value);
              void player.current?.seek(value, approximate).catch(fail);
            }}
          />
          <span className="time-code">
            {time(
              timeline
                ? beatToSeconds(timeline.duration, timeline.tempos) /
                    (tempo / (timeline.tempos[0]?.bpm || 120))
                : 0,
            )}
          </span>
        </div>
        <div className="transport-settings">
          <label>
            速度
            <input
              aria-label="播放速度"
              type="number"
              min={20}
              max={300}
              value={tempoDraft}
              disabled={!timeline}
              onChange={(e) => {
                setTempoDraft(e.target.value);
                const value = Number(e.target.value);
                if (value >= 20 && value <= 300) {
                  setTempo(value);
                  player.current?.setOptions({ tempo: value });
                }
              }}
              onBlur={() => setTempoDraft(String(tempo))}
            />
            <span>BPM</span>
          </label>
          <label>
            音量
            <input
              aria-label="音量"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => {
                const value = Number(e.target.value);
                setVolume(value);
                player.current?.setOptions({ volume: value });
              }}
            />
          </label>
        </div>
      </footer>
    </div>
  );
}
