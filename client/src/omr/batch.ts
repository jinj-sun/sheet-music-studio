import { pageXml, type ProjectPage } from '../storage/pages';
import { parseScore } from '../music/score';
import { OMR_ERRORS, type Progress, type RecognizeResult } from './recognizer';

export interface BatchProgress {
  page: number;
  totalPages: number;
  stage: Progress;
}

export async function recognizePages(
  input: ProjectPage[],
  infer: (
    image: Blob,
    progress: (p: Progress) => void,
    signal: AbortSignal,
  ) => Promise<RecognizeResult>,
  signal: AbortSignal,
  hooks: {
    onProgress: (p: BatchProgress) => void;
    onPage: (pages: ProjectPage[]) => void | Promise<void>;
  },
) {
  let pages = [...input];
  for (const [index, page] of input.entries()) {
    signal.throwIfAborted();
    if (pageXml(page)) continue;
    const progress = (stage: Progress) => {
      if (!signal.aborted)
        hooks.onProgress({ page: index + 1, totalPages: input.length, stage });
    };
    progress({ stage: 'models', done: 0, total: 0 });
    let result: RecognizeResult | undefined, error: string | undefined;
    try {
      const image = await (await fetch(page.image.dataUrl, { signal })).blob();
      result = await infer(image, progress, signal);
      signal.throwIfAborted();
      if (!result.ok)
        error = `${OMR_ERRORS[result.error] || result.error}${result.log ? `：${result.log}` : ''}`;
      else {
        const parsed = parseScore(result.musicXml);
        if (parsed.readonly || !parsed.notes.length)
          throw new Error('未生成可编辑的五线谱音符');
      }
    } catch (e) {
      signal.throwIfAborted();
      error = e instanceof Error ? e.message : String(e);
    }
    pages = pages.map((p, i) =>
      i === index
        ? {
            ...p,
            recognition: result
              ? JSON.parse(JSON.stringify(result))
              : p.recognition,
            error,
          }
        : p,
    );
    await hooks.onPage(pages);
    if (result && !result.ok && result.error === 'engine_missing') break;
  }
  signal.throwIfAborted();
  return pages;
}
