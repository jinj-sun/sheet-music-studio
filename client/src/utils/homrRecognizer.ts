import { logger } from '@lark-apaas/client-toolkit/logger';

export interface RecognizerProgress {
  stage: string;
  done: number;
  total: number;
}

export interface RecognitionSuccess {
  ok: true;
  musicXml: string;
  staves: Array<{ index: number; cx: number; cy: number; w: number; h: number }>;
  texts: Array<{ staff: number; text: string; score: number; x0: number; y0: number; x1: number; y1: number }>;
  backend: string;
}

export interface RecognitionFailure {
  ok: false;
  error: string;
  log?: string;
}

export type RecognitionResult = RecognitionSuccess | RecognitionFailure;

let recognizer: any = null;

export async function createRecognizer(baseUrl: string): Promise<void> {
  if (recognizer) return;

  const { createRecognizer: createHomrRecognizer } = await import('homr-web');
  recognizer = await createHomrRecognizer({ baseUrl, prefer: 'wasm' });
  logger.info('OMR recognizer created, backend:', recognizer.backend);
}

export function getBackend(): string {
  return recognizer?.backend || '';
}

export async function recognizeImage(
  imageBlob: Blob | File,
  onProgress: (progress: RecognizerProgress) => void,
  signal: AbortSignal
): Promise<RecognitionResult> {
  if (!recognizer) {
    return { ok: false, error: 'recognizer_not_initialized', log: '识别器尚未初始化' };
  }

  try {
    const result = await recognizer.recognizePage(imageBlob, {
      onProgress: ({ stage, done, total }: { stage: string; done: number; total: number }) => {
        onProgress({ stage, done, total });
      },
      signal,
    });

    if (result.ok) {
      return {
        ok: true,
        musicXml: result.musicXml,
        staves: result.staves || [],
        texts: result.texts || [],
        backend: result.backend,
      };
    } else {
      return {
        ok: false,
        error: result.error,
        log: result.log,
      };
    }
  } catch (err) {
    logger.error('Recognition error', err);
    return {
      ok: false,
      error: 'engine_failed',
      log: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function disposeRecognizer(): Promise<void> {
  if (recognizer) {
    try {
      await recognizer.dispose();
    } catch (err) {
      logger.error('Failed to dispose recognizer', err);
    }
    recognizer = null;
  }
}
