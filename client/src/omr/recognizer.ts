import type { Recognizer, RecognizeResult, Progress } from 'homr-web';
import models from './models.json';
export type { Progress, RecognizeResult };
export interface ModelStatus {
  id: string;
  path: string;
  available: boolean;
  detail: string;
}
const base = () =>
  new URL(`${import.meta.env.BASE_URL}models/`, document.baseURI).href;
export async function checkModels(
  signal?: AbortSignal,
): Promise<ModelStatus[]> {
  return Promise.all(
    models.map(async (model) => {
      try {
        const response = await fetch(new URL(model.path, base()), {
          method: 'HEAD',
          cache: 'no-store',
          signal,
        });
        const length = Number(response.headers.get('content-length'));
        const isHtml = /text\/html/i.test(
          response.headers.get('content-type') || '',
        );
        const available =
          response.ok && !isHtml && (!length || length === model.bytes);
        return {
          id: model.id,
          path: model.path,
          available,
          detail: available
            ? '文件可访问（引擎加载时将校验 SHA-256）'
            : `缺失或格式/大小错误（HTTP ${response.status}）`,
        };
      } catch (e) {
        if (signal?.aborted) throw e;
        return {
          id: model.id,
          path: model.path,
          available: false,
          detail: '网络不可访问',
        };
      }
    }),
  );
}
export async function requireModels(signal: AbortSignal) {
  const missing = (await checkModels(signal)).filter((s) => !s.available);
  signal.throwIfAborted();
  if (missing.length)
    throw new Error(
      `缺少 ${missing.length} 个识谱模型，未执行识别。请在项目目录运行 npm run models:download，然后 npm run models:check。缺少：${missing.map((m) => m.id).join('、')}`,
    );
}
export const OMR_ERRORS: Record<string, string> = {
  bad_input: '图片解码失败，请使用 PNG、JPEG 或 WebP',
  not_music: '未检测到有效五线谱，请提高分辨率并裁剪无关背景',
  tablature_only:
    '检测到指法谱；当前工作台只编辑五线谱，原图与识别元数据已保留',
  engine_missing:
    '模型缺失或 SHA-256 校验失败，请运行 npm run models:download 和 npm run models:check',
  engine_failed: '识谱引擎运行失败，请检查浏览器内存和模型文件',
  busy: '引擎正在处理另一张图片',
  cancelled: '已取消识别',
  timeout: '识别超时，请缩小图片后重试',
  worker_lost: '识谱 Worker 已退出，请重新识别',
};
/** Initializes the real Worker/OpenCV/ONNX backend without requiring a model. */
export async function probeOmrRuntime(): Promise<{
  backend: string;
  reason: string;
  threads: number;
}> {
  const { createRecognizer } = await import('homr-web');
  let worker: Worker | undefined;
  let engine: Recognizer | undefined;
  try {
    engine = await createRecognizer({
      baseUrl: base(),
      prefer: 'wasm',
      wasmPaths: new URL(
        `${import.meta.env.BASE_URL}omr-runtime/`,
        document.baseURI,
      ),
      createWorker: () => {
        worker = new Worker(
          new URL('./recognizer.worker.ts', import.meta.url),
          { type: 'module' },
        );
        return worker;
      },
    });
    return {
      backend: engine.backend,
      reason: engine.backendReason,
      threads: engine.numThreads,
    };
  } finally {
    await engine?.dispose();
    worker?.terminate();
  }
}
export class OmrRecognizer {
  private engine: Recognizer | null = null;
  private worker: Worker | null = null;
  private generation = 0;
  async recognize(
    file: Blob,
    onProgress: (p: Progress) => void,
    signal: AbortSignal,
    modelsChecked = false,
  ): Promise<RecognizeResult> {
    if (file.size > 25 * 1024 * 1024)
      throw new Error('图片超过 25 MB，请先缩小图片');
    const generation = ++this.generation;
    if (!modelsChecked) await requireModels(signal);
    signal.throwIfAborted();
    const abort = () => {
      void this.dispose();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (!this.engine) {
        const { createRecognizer } = await import('homr-web');
        signal.throwIfAborted();
        const engine = await createRecognizer({
          baseUrl: base(),
          prefer: 'wasm',
          wasmPaths: new URL(
            `${import.meta.env.BASE_URL}omr-runtime/`,
            document.baseURI,
          ),
          createWorker: () => {
            const w = new Worker(
              new URL('./recognizer.worker.ts', import.meta.url),
              { type: 'module' },
            );
            this.worker = w;
            return w;
          },
        });
        if (signal.aborted || generation !== this.generation) {
          await engine.dispose();
          signal.throwIfAborted();
          throw new Error('识别已取消');
        }
        this.engine = engine;
      }
      const result = await this.engine.recognizePage(file, {
        signal,
        onProgress,
      });
      signal.throwIfAborted();
      if (generation !== this.generation)
        throw new Error('忽略已取消的识别结果');
      if (!result.ok && result.error === 'worker_lost') await this.dispose();
      return result;
    } catch (error) {
      if (generation === this.generation) await this.dispose();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  async dispose() {
    this.generation++;
    const engine = this.engine;
    this.engine = null;
    this.worker?.terminate();
    this.worker = null;
    await engine?.dispose();
  }
}
