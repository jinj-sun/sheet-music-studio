// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import {
  transferArtifact,
  discardArtifactChunks,
  githubDownloadUrl,
} from '../../scripts/model-transfer.mjs';

const data = Buffer.from('0123456789abcdefghij');
function rangeServer(options = {}) {
  return vi.fn(async (_url, request) => {
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(request.headers.Range);
    const start = Number(from),
      end = Math.min(Number(to), data.length - 1);
    if (options.failAt === start && end !== start)
      throw new Error('Connection interrupted');
    const body = data.subarray(start, end + 1);
    return new Response(
      options.shortBody && start !== end ? body.subarray(0, -1) : body,
      {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${options.wrongRange && start !== end ? end + 1 : end}/${data.length}`,
        },
      },
    );
  });
}
async function withDirectory(run) {
  const base = resolve('tmp/model-transfer-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'case-'));
  if (dirname(directory) !== base) throw new Error('Unsafe test cleanup path');
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}
it('assembles validated parallel ranges into exact original bytes', async () =>
  withDirectory(async (directory) => {
    const fetchImpl = rangeServer();
    const onProgress = vi.fn();
    const result = await transferArtifact(
      'https://example.test/model',
      directory,
      { fetchImpl, chunkSize: 4, concurrency: 3, onProgress },
    );
    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(onProgress.mock.calls.at(-1)[0].received).toBe(data.length);
  }));
it('resumes valid cached chunks without fetching them again', async () =>
  withDirectory(async (directory) => {
    await writeFile(join(directory, 'chunk-00000'), data.subarray(0, 4));
    const fetchImpl = rangeServer();
    expect(
      await transferArtifact('https://example.test/model', directory, {
        fetchImpl,
        chunkSize: 4,
        concurrency: 2,
      }),
    ).toEqual(data);
    expect(fetchImpl.mock.calls.map((c) => c[1].headers.Range)).not.toContain(
      'bytes=0-3',
    );
  }));
it('retains completed chunks after failure and resumes the next attempt', async () =>
  withDirectory(async (directory) => {
    await expect(
      transferArtifact('https://example.test/model', directory, {
        fetchImpl: rangeServer({ failAt: 4 }),
        chunkSize: 4,
        concurrency: 1,
        retries: 1,
      }),
    ).rejects.toThrow('interrupted');
    expect(await readFile(join(directory, 'chunk-00000'))).toEqual(
      data.subarray(0, 4),
    );
    const recovered = rangeServer();
    expect(
      await transferArtifact('https://example.test/model', directory, {
        fetchImpl: recovered,
        chunkSize: 4,
      }),
    ).toEqual(data);
    expect(recovered.mock.calls.map((c) => c[1].headers.Range)).not.toContain(
      'bytes=0-3',
    );
  }));
it('rejects incorrect content-range metadata', async () =>
  withDirectory(async (directory) => {
    await expect(
      transferArtifact('https://example.test/model', directory, {
        fetchImpl: rangeServer({ wrongRange: true }),
        chunkSize: 4,
        retries: 1,
      }),
    ).rejects.toThrow('Invalid range response');
  }));
it('rejects truncated bodies rather than caching incomplete chunks', async () =>
  withDirectory(async (directory) => {
    await expect(
      transferArtifact('https://example.test/model', directory, {
        fetchImpl: rangeServer({ shortBody: true }),
        chunkSize: 4,
        retries: 1,
      }),
    ).rejects.toThrow('Incomplete byte range');
  }));
it('streams a full response if the host does not implement Range', async () =>
  withDirectory(async (directory) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(data, {
          status: 200,
          headers: { 'content-length': String(data.length) },
        }),
    );
    expect(
      await transferArtifact('https://example.test/model', directory, {
        fetchImpl,
      }),
    ).toEqual(data);
  }));
it('rejects an HTTP failure without treating its body as model data', async () =>
  withDirectory(async (directory) => {
    await expect(
      transferArtifact('https://example.test/model', directory, {
        fetchImpl: async () => new Response('no', { status: 404 }),
      }),
    ).rejects.toThrow('HTTP 404');
  }));

it('reuses the official redirected URL for subsequent ranges', async () =>
  withDirectory(async (directory) => {
    const server = rangeServer();
    const fetchImpl = vi.fn(async (url, options) => {
      const response = await server(url, options);
      Object.defineProperty(response, 'url', {
        value: 'https://official-cdn.test/file',
      });
      return response;
    });
    expect(
      await transferArtifact('https://official.test/source', directory, {
        fetchImpl,
        chunkSize: 4,
      }),
    ).toEqual(data);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://official.test/source');
    expect(
      fetchImpl.mock.calls
        .slice(1)
        .every((call) => call[0] === 'https://official-cdn.test/file'),
    ).toBe(true);
  }));
it('retries a transient range failure without discarding completed ranges', async () =>
  withDirectory(async (directory) => {
    const server = rangeServer();
    let interrupted = false;
    const fetchImpl = vi.fn(async (url, options) => {
      if (options.headers.Range === 'bytes=4-7' && !interrupted) {
        interrupted = true;
        throw new Error('Temporary network error');
      }
      return server(url, options);
    });
    expect(
      await transferArtifact('https://official.test/source', directory, {
        fetchImpl,
        chunkSize: 4,
        retryDelayMs: 0,
      }),
    ).toEqual(data);
    expect(
      fetchImpl.mock.calls.filter(
        (call) => call[1].headers.Range === 'bytes=4-7',
      ),
    ).toHaveLength(2);
  }));
it('invalidates only its own cache files after a checksum mismatch', async () =>
  withDirectory(async (directory) => {
    await writeFile(join(directory, 'chunk-00000'), data);
    await writeFile(join(directory, 'chunk-00001.download'), data);
    await writeFile(join(directory, 'keep.txt'), 'unrelated');
    await discardArtifactChunks(directory);
    expect(await readFile(join(directory, 'keep.txt'), 'utf8')).toBe(
      'unrelated',
    );
    await expect(
      readFile(join(directory, 'chunk-00000')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  }));

it('keeps official sources by default and validates an optional public mirror origin', () => {
  const source =
    'https://github.com/owner/repo/releases/download/tag/model.zip';
  expect(githubDownloadUrl(source)).toBe(source);
  expect(githubDownloadUrl(source, 'https://mirror.test')).toBe(
    `https://mirror.test/${source}`,
  );
  expect(
    githubDownloadUrl('https://www.modelscope.cn/model', 'https://mirror.test'),
  ).toBe('https://www.modelscope.cn/model');
  expect(() => githubDownloadUrl(source, 'http://mirror.test')).toThrow(
    'HTTPS origin',
  );
  expect(() =>
    githubDownloadUrl(source, 'https://name:password@mirror.test'),
  ).toThrow('credentials');
});
