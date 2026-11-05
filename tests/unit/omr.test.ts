import { it, expect, vi } from 'vitest';
import { checkModels, OmrRecognizer } from '../../client/src/omr/recognizer';
it('does not mistake SPA HTML fallbacks for models', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('<html>SPA</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ),
  );
  const result = await checkModels();
  expect(result).toHaveLength(7);
  expect(result.every((m) => !m.available)).toBe(true);
});
it('reports missing models and never produces fabricated recognition XML', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 })),
  );
  const recognizer = new OmrRecognizer();
  await expect(
    recognizer.recognize(
      new Blob(['image']),
      vi.fn(),
      new AbortController().signal,
    ),
  ).rejects.toThrow('未执行识别');
});
it('checks pinned file sizes before allowing recognition', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('', {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': '4',
          },
        }),
    ),
  );
  expect((await checkModels()).every((m) => !m.available)).toBe(true);
});
it('propagates cancellation during preflight', async () => {
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError');
    }),
  );
  await expect(checkModels(controller.signal)).rejects.toThrow('cancelled');
});
