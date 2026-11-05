import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, basename, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import {
  transferArtifact,
  discardArtifactChunks,
  githubDownloadUrl,
} from './model-transfer.mjs';

async function validModel(path, model) {
  try {
    if ((await stat(path)).size !== model.bytes) return false;
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    return hash.digest('hex') === model.sha256;
  } catch {
    return false;
  }
}
function sourceOf(filename) {
  const ocr =
    'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx';
  if (filename === 'PP-OCRv6_det_small.onnx')
    return { url: `${ocr}/PP-OCRv6/det/${filename}` };
  if (filename === 'PP-OCRv6_rec_small.onnx')
    return { url: `${ocr}/PP-OCRv6/rec/${filename}` };
  if (filename === 'ch_ppocr_mobile_v2.0_cls_mobile.onnx')
    return { url: `${ocr}/PP-OCRv4/cls/${filename}` };
  if (filename.startsWith('tab-digits-'))
    return {
      url: `https://github.com/jymen/homr-web/releases/download/models-homr0.7.0/${filename}`,
    };
  return {
    zipped: true,
    url: `https://github.com/liebharc/homr/releases/download/onnx_checkpoints/${filename.replace(/\.onnx$/, '.zip')}`,
  };
}
async function main() {
  const models = JSON.parse(
    await readFile('client/src/omr/models.json', 'utf8'),
  );
  const concurrency = Number(process.env.OMR_DOWNLOAD_CONCURRENCY || 6);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12)
    throw new Error('OMR_DOWNLOAD_CONCURRENCY must be an integer from 1 to 12');
  let failures = 0,
    next = 0;
  async function install(model) {
    const path = `client/public/models/${model.path}`;
    if (await validModel(path, model)) {
      console.log(`Already verified ${model.id}`);
      return;
    }
    try {
      const filename = basename(model.path),
        { url, zipped } = sourceOf(filename);
      const cache = resolve('tmp/model-downloads', model.sha256);
      console.log(
        `Downloading ${model.id} (${(model.bytes / 1e6).toFixed(1)} MB, resumable)`,
      );
      let previousReport = 0;
      let data = await transferArtifact(
        githubDownloadUrl(url, process.env.OMR_GITHUB_MIRROR),
        cache,
        {
          concurrency,
          onProgress: ({ received, total, cached }) => {
            if (Date.now() - previousReport < 1500 && received !== total)
              return;
            previousReport = Date.now();
            console.log(
              `${model.id}: ${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB${cached ? ' (resumed)' : ''}`,
            );
          },
        },
      );
      if (zipped) {
        const files = unzipSync(data, {
          filter: (entry) =>
            entry.name === filename && entry.originalSize === model.bytes,
        });
        if (!files[filename])
          throw new Error('Pinned ONNX file not found inside upstream ZIP');
        data = Buffer.from(files[filename]);
      }
      if (
        data.length !== model.bytes ||
        createHash('sha256').update(data).digest('hex') !== model.sha256
      ) {
        await discardArtifactChunks(cache);
        throw new Error(
          'Integrity check failed; cached ranges cleared, existing model preserved',
        );
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.download`, data);
      await rename(`${path}.download`, path);
      console.log(`Verified ${model.id}`);
    } catch (error) {
      failures++;
      console.error(
        `FAILED ${model.id}: ${error.message}. Retry resumes completed ranges under tmp/model-downloads.`,
      );
    }
  }
  // Bounded model concurrency also uses both official hosts while a large file is slow.
  const ordered = [...models].sort((a, b) => a.bytes - b.bytes);
  async function worker() {
    while (next < ordered.length) await install(ordered[next++]);
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  if (failures) {
    console.error(
      `${failures} model downloads failed. Verified files and completed chunks are retained.`,
    );
    process.exitCode = 1;
  } else console.log(`All ${models.length} models verified.`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
