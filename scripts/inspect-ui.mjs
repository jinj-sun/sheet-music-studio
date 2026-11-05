import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const browser = await chromium.launch({
  channel: process.env.PW_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.argv[2] || 'http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: /从一张乐谱/ }).waitFor();
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/welcome.png' });
  await page
    .getByTestId('score-file-input')
    .setInputFiles(resolve('tests/fixtures/complex.musicxml'));
  await page.locator('[data-note-id="p0m1n1"]').waitFor();
  await page.getByText('试听 / MIDI 存在解释限制').click();
  await page.screenshot({ path: 'docs/screenshots/workbench.png' });
  // A rendered test fixture is used only as a visual comparison reference.
  // This does not execute OMR and is never represented as recognized output.
  const svg = await page
    .getByTestId('score-paper')
    .locator('svg')
    .first()
    .evaluate((element) => new XMLSerializer().serializeToString(element));
  const referencePage = await context.newPage();
  await referencePage.setContent(
    `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" />`,
  );
  await referencePage
    .locator('img')
    .screenshot({ path: 'docs/screenshots/reference.png' });
  await referencePage.close();
  await page.getByTestId('image-file-input').setInputFiles({
    name: '校对流程测试原图.png',
    mimeType: 'image/png',
    buffer: await readFile('docs/screenshots/reference.png'),
  });
  await page.getByRole('img', { name: '乐谱原图', exact: true }).waitFor();
  await page.locator('[data-note-id="p0m1n1"]').waitFor();
  await page.screenshot({ path: 'docs/screenshots/comparison.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'docs/screenshots/mobile.png',
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'Saved welcome, workbench, comparison and mobile screenshots; no pageerror events.',
  );
} finally {
  await browser.close();
}
