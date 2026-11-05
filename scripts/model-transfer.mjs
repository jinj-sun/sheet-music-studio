import {
  mkdir,
  readFile,
  writeFile,
  rename,
  stat,
  open,
  readdir,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sizeOf = async (path) => {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
};
function rangeOf(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || '');
  return match ? match.slice(1).map(Number) : null;
}
export function githubDownloadUrl(source, mirror) {
  if (!mirror || !source.startsWith('https://github.com/')) return source;
  const target = new URL(mirror);
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/'
  )
    throw new Error(
      'OMR_GITHUB_MIRROR must be an HTTPS origin without credentials or a path',
    );
  return `${target.origin}/${source}`;
}
/** Verified ranges are cached independently. Interrupted transfers never replace a model. */
export async function transferArtifact(url, cacheDirectory, options = {}) {
  const {
    fetchImpl = fetch,
    chunkSize = 1024 * 1024,
    concurrency = 6,
    timeoutMs = 120000,
    retries = 3,
    retryDelayMs = 800,
    onProgress = () => {},
  } = options;
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize <= 0 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1
  )
    throw new Error('Invalid transfer configuration');
  await mkdir(cacheDirectory, { recursive: true });
  let transferUrl = url;
  async function request(headers) {
    return fetchImpl(transferUrl, {
      headers: { 'Cache-Control': 'no-cache', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
  }
  const probe = await request({ Range: 'bytes=0-0' });
  if (!probe.ok) {
    await probe.body?.cancel();
    throw new Error(`HTTP ${probe.status}`);
  }
  const range = rangeOf(probe.headers.get('content-range'));
  // Official redirect URLs stay in memory, avoiding one redirect per chunk.
  if (probe.url && /^https?:/.test(probe.url)) transferUrl = probe.url;
  if (probe.status !== 206 || !range) {
    // Some hosts ignore Range. Stream to disk instead of buffering silently for minutes.
    if (probe.status !== 200) {
      await probe.body?.cancel();
      throw new Error('Server returned an invalid byte-range response');
    }
    const partial = join(cacheDirectory, 'artifact.download');
    const output = await open(partial, 'w');
    let received = 0;
    const total = Number(probe.headers.get('content-length')) || 0;
    try {
      for await (const bytes of probe.body) {
        received += bytes.length;
        if (received > 200 * 1024 * 1024)
          throw new Error('Artifact exceeds 200 MB');
        await output.write(bytes);
        onProgress({ received, total, cached: false });
      }
    } finally {
      await output.close();
    }
    if (total && received !== total)
      throw new Error('Incomplete artifact response');
    return readFile(partial);
  }
  if (
    range[0] !== 0 ||
    range[1] !== 0 ||
    range[2] <= 0 ||
    range[2] > 200 * 1024 * 1024
  ) {
    await probe.body?.cancel();
    throw new Error('Invalid artifact length');
  }
  const probeBytes = new Uint8Array(await probe.arrayBuffer());
  if (probeBytes.length !== 1) throw new Error('Invalid probe body length');
  const total = range[2],
    count = Math.ceil(total / chunkSize);
  const paths = Array.from({ length: count }, (_, i) =>
    join(cacheDirectory, `chunk-${String(i).padStart(5, '0')}`),
  );
  const pending = [];
  let received = 0;
  for (let i = 0; i < count; i++) {
    const length = Math.min(chunkSize, total - i * chunkSize);
    if ((await sizeOf(paths[i])) === length) received += length;
    else pending.push(i);
  }
  onProgress({ received, total, cached: received > 0 });
  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const index = pending[next++],
        start = index * chunkSize,
        end = Math.min(total - 1, start + chunkSize - 1);
      let lastError;
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const response = await request({ Range: `bytes=${start}-${end}` });
          const actualRange = rangeOf(response.headers.get('content-range'));
          if (
            response.status !== 206 ||
            !actualRange ||
            actualRange[0] !== start ||
            actualRange[1] !== end ||
            actualRange[2] !== total
          ) {
            await response.body?.cancel();
            throw new Error(`Invalid range response: HTTP ${response.status}`);
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== end - start + 1)
            throw new Error('Incomplete byte range');
          await writeFile(`${paths[index]}.download`, bytes);
          await rename(`${paths[index]}.download`, paths[index]);
          received += bytes.length;
          onProgress({ received, total, cached: false });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt + 1 < retries) await delay(retryDelayMs * (attempt + 1));
        }
      }
      if (lastError)
        throw new Error(`Chunk ${index + 1}/${count}: ${lastError.message}`);
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
  return Buffer.concat(
    await Promise.all(paths.map((path) => readFile(path))),
    total,
  );
}

export async function discardArtifactChunks(directory) {
  for (const name of await readdir(directory)) {
    if (/^chunk-\d{5}(?:\.download)?$/.test(name))
      await unlink(join(directory, name));
  }
}
