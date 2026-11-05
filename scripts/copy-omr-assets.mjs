import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = resolve('node_modules/onnxruntime-web/dist');
const target = resolve('client/public/omr-runtime');
await mkdir(target, { recursive: true });
const files = (await readdir(source)).filter((name) =>
  /\.(wasm|mjs)$/.test(name),
);
for (const name of files)
  await copyFile(resolve(source, name), resolve(target, name));
console.log(
  `Copied ${files.length} ONNX runtime assets; recognition models are installed separately.`,
);
