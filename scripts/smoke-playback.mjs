import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve(
  process.argv[2] || 'tests/fixtures/piano-rhythm.musicxml',
);
const output = resolve(process.env.PLAYBACK_OUTPUT || 'tmp/playback-smoke');
const baseURL = process.env.APP_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PW_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
  });
  const pageErrors = [],
    requests = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/audio/piano/'))
      requests.push({ file: r.url().split('/').at(-1), status: r.status() });
  });
  // Observe real native AudioBufferSourceNodes. No replacement audio, samples or clocks.
  await page.addInitScript(() => {
    window.pianoAudit = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      createBufferSource() {
        const source = super.createBufferSource(),
          nativeStart = source.start.bind(source);
        source.start = (...args) => {
          const data = source.buffer.getChannelData(0);
          let sum = 0,
            peak = 0;
          for (let i = 0; i < data.length; i += 16) {
            sum += data[i] ** 2;
            peak = Math.max(peak, Math.abs(data[i]));
          }
          window.pianoAudit.push({
            start: args[0],
            offset: args[1],
            rate: source.playbackRate.value,
            duration: source.buffer.duration,
            channels: source.buffer.numberOfChannels,
            peak,
            rms: Math.sqrt(sum / Math.ceil(data.length / 16)),
          });
          return nativeStart(...args);
        };
        return source;
      }
    };
  });
  await page.goto(baseURL);
  await page.getByTestId('score-file-input').setInputFiles(input);
  const paper = page.getByTestId('score-paper');
  await paper.locator('svg').first().waitFor();
  const approximate = page.getByRole('checkbox', { name: /我已了解/ });
  if (await approximate.count()) await approximate.check();
  await page.getByLabel('播放速度', { exact: true }).fill('60');
  await page.getByLabel('播放进度', { exact: true }).fill('1.1');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.playing-note').length > 0,
  );
  const report = await page.evaluate(() => ({
    mappedNotes: document.querySelectorAll('.score-paper [data-note-id]')
      .length,
    beamGroups: document.querySelectorAll('.score-paper .vf-beam').length,
    activeNotes: [...document.querySelectorAll('.playing-note')].map((e) => ({
      id: e.getAttribute('data-note-id'),
      fill: getComputedStyle(e.querySelector('path') || e).fill,
    })),
    nativeAudio: window.pianoAudit,
  }));
  await page.screenshot({ path: resolve(output, 'playback.png') });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('导出', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出 MusicXML', exact: true })
    .click();
  const exported = await readFile(await (await download).path(), 'utf8');
  const source = await readFile(input, 'utf8');
  const original = input.endsWith('.json') ? JSON.parse(source).xml : source;
  Object.assign(report, {
    baseURL,
    pageErrors,
    requests,
    xmlUnchanged: exported === original,
  });
  await writeFile(
    resolve(output, 'verification.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    pageErrors.length ||
    !report.xmlUnchanged ||
    !report.beamGroups ||
    !report.nativeAudio.length ||
    report.nativeAudio.some((n) => !n.rms || !Number.isFinite(n.rms)) ||
    report.activeNotes.some((n) => n.fill !== 'rgb(216, 139, 48)')
  )
    throw new Error(
      '真实采样 / 高亮 / XML 保真验收未通过，详见 verification.json',
    );
} finally {
  await browser.close();
}
