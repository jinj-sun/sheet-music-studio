import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, basename } from 'node:path';
import { unzipSync } from 'fflate';
async function main() {
  const models = JSON.parse(
    await readFile('client/src/omr/models.json', 'utf8'),
  );
  let failures = 0;
  for (const model of models) {
    const path = `client/public/models/${model.path}`;
    try {
      try {
        if (
          (await stat(path)).size === model.bytes &&
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex') === model.sha256
        ) {
          console.log(`Already verified ${model.id}`);
          continue;
        }
      } catch {
        /* absent */
      }
      const filename = basename(model.path);
      let url,
        zipped = false;
      const ocr =
        'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx';
      if (filename === 'PP-OCRv6_det_small.onnx')
        url = `${ocr}/PP-OCRv6/det/${filename}`;
      else if (filename === 'PP-OCRv6_rec_small.onnx')
        url = `${ocr}/PP-OCRv6/rec/${filename}`;
      else if (filename === 'ch_ppocr_mobile_v2.0_cls_mobile.onnx')
        url = `${ocr}/PP-OCRv4/cls/${filename}`;
      else if (filename.startsWith('tab-digits-'))
        url = `https://github.com/jymen/homr-web/releases/download/models-homr0.7.0/${filename}`;
      else {
        zipped = true;
        url = `https://github.com/liebharc/homr/releases/download/onnx_checkpoints/${filename.replace(/\.onnx$/, '.zip')}`;
      }
      console.log(
        `Downloading ${model.id} (${(model.bytes / 1e6).toFixed(1)} MB)`,
      );
      const response = await fetch(url, {
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      let data = Buffer.from(await response.arrayBuffer());
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
      )
        throw new Error(`Integrity check failed; existing model preserved`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.download`, data);
      await rename(`${path}.download`, path);
      console.log(`Verified ${model.id}`);
    } catch (error) {
      failures++;
      console.error(`FAILED ${model.id}: ${error.message}`);
    }
  }
  if (failures) {
    console.error(
      `${failures} model downloads failed. Retry this command or copy files from another machine; verified files will be reused.`,
    );
    process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
