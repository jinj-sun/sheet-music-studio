import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

execFileSync(process.execPath, ['scripts/check-models.mjs'], {
  stdio: 'inherit',
});
const input = resolve(process.argv[2] || 'docs/screenshots/reference.png');
const baseURL = process.env.OMR_TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  channel: process.env.PW_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.getByTestId('image-file-input').setInputFiles(input);
  await page.getByRole('img', { name: '乐谱原图', exact: true }).waitFor();
  const started = Date.now();
  await page.getByRole('button', { name: '识别为新项目', exact: true }).click();
  let lastProgress = '',
    success = false;
  while (Date.now() - started < 600000) {
    const error = page.locator('.notice.error');
    if (await error.count()) throw new Error(await error.innerText());
    if (await page.getByText(/识别结果已建立为新项目/).isVisible()) {
      success = true;
      break;
    }
    const progress = page.locator('.recognition-progress');
    if (await progress.count()) {
      const value = (await progress.innerText()).replace(/\s+/g, ' ');
      if (value !== lastProgress) {
        console.log(`OMR ${(Date.now() - started) / 1000}s: ${value}`);
        lastProgress = value;
      }
    }
    await page.waitForTimeout(3000);
  }
  if (!success)
    throw new Error(
      'Real recognition exceeded 10 minutes; no success was recorded',
    );
  await page
    .getByTestId('score-paper')
    .locator('svg')
    .first()
    .waitFor({ timeout: 30000 });
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/omr-recognition.png' });
  await page.getByRole('tab', { name: 'XML 源码' }).click();
  const xml = await page
    .getByRole('textbox', { name: 'MusicXML 源码' })
    .inputValue();
  const noteCount = await page.evaluate(
    (value) =>
      new DOMParser()
        .parseFromString(value, 'application/xml')
        .getElementsByTagName('note').length,
    xml,
  );
  if (!noteCount) throw new Error('Recognition returned no notes');
  await page.locator('.export-menu summary').click();
  const pending = page.waitForEvent('download');
  await page
    .locator('.menu-popover')
    .getByRole('button', { name: '下载项目备份', exact: true })
    .click();
  const downloaded = await pending;
  const project = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  if (
    !project.recognition?.ok ||
    project.recognition.musicXml !== xml ||
    !String(project.recognition.backend).startsWith('wasm')
  )
    throw new Error(
      'Stored engine result does not match actual WASM recognition',
    );
  if (errors.length) throw new Error(errors.join('\n'));
  const result = {
    verifiedAt: new Date().toISOString(),
    input: basename(input),
    inputSha256: createHash('sha256')
      .update(await readFile(input))
      .digest('hex'),
    browser: browser.version(),
    backend: project.recognition.backend,
    elapsedMs: Date.now() - started,
    notes: noteCount,
    staves: project.recognition.staves?.length || 0,
    pageErrors: errors,
    source:
      'Actual homr-web inference; no mocked model requests or substituted MusicXML',
    accuracy:
      'Pipeline smoke test on a generated test-score image; musical accuracy is not certified',
  };
  await writeFile('docs/omr-smoke.musicxml', xml);
  await writeFile(
    'docs/omr-smoke-result.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
