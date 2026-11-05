import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = new URL('../client/public/audio/piano/', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', directory), 'utf8'),
);
if (manifest.files.length !== 30)
  throw new Error('钢琴采样清单应包含 A0–C8 的 30 个录音');
for (const file of manifest.files) {
  const data = await readFile(new URL(file.file, directory));
  if (
    data.length !== file.bytes ||
    createHash('sha256').update(data).digest('hex') !== file.sha256
  )
    throw new Error(
      `钢琴采样校验失败：${file.file}。请从同版本源码恢复 client/public/audio/piano。`,
    );
}
console.log('钢琴采样 30/30：大小与 SHA-256 全部通过，本地播放无需外部 CDN。');
