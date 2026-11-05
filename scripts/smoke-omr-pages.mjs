import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, basename } from 'node:path';

execFileSync(process.execPath, ['scripts/check-models.mjs'], {
  stdio: 'inherit',
});
const reference = 'docs/screenshots/reference.png';
const supplied = process.argv.slice(2),
  paths = supplied.length ? supplied : [reference, reference];
if (paths.length < 2) throw new Error('请提供至少两页 PNG、JPEG 或 WebP 图片');
const files = await Promise.all(
  paths.map(async (path, i) => {
    const ext = extname(path).toLowerCase(),
      mimeType =
        ext === '.webp'
          ? 'image/webp'
          : ['.jpg', '.jpeg'].includes(ext)
            ? 'image/jpeg'
            : 'image/png';
    return {
      name: `page-${String(i + 1).padStart(2, '0')}-${basename(path)}`,
      mimeType,
      buffer: await readFile(resolve(path)),
    };
  }),
);
const url = process.env.OMR_TEST_URL || 'http://127.0.0.1:5173/';
const output = process.env.OMR_PAGES_OUTPUT || 'tmp/omr-pages-smoke';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PW_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const pageErrors = [],
    progressSeen = [],
    preflight = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('request', (r) => {
    if (r.method() === 'HEAD' && r.url().includes('/models/'))
      preflight.push(r.url());
  });
  await page.goto(url);
  await page.getByTestId('image-file-input').setInputFiles(files);
  await page.getByRole('img', { name: '乐谱原图', exact: true }).waitFor();
  const begin = Date.now();
  await page
    .getByRole('button', { name: `识别全部 ${files.length} 页`, exact: true })
    .click();
  const success = page.getByText(/识别结果已建立为新项目/);
  for (let previous = ''; !(await success.isVisible());) {
    if (Date.now() - begin > 600_000)
      throw new Error('多页识别超时，无成功记录');
    const error = page.locator('.notice.error');
    if (await error.count()) throw new Error(await error.innerText());
    const progress = (
      await page.locator('.recognition-progress').allTextContents()
    )
      .join(' ')
      .replace(/\s+/g, ' ');
    if (progress && progress !== previous) {
      previous = progress;
      progressSeen.push(progress);
      console.log(`${Math.round((Date.now() - begin) / 1000)}s: ${progress}`);
    }
    await page.waitForTimeout(1500);
  }
  const elapsedMs = Date.now() - begin;
  await page.getByTestId('score-paper').locator('svg').first().waitFor();
  await page.locator('.export-menu summary').click();
  const pending = page.waitForEvent('download');
  await page
    .locator('.menu-popover')
    .getByRole('button', { name: '下载项目备份', exact: true })
    .click();
  const project = JSON.parse(
    await readFile(await (await pending).path(), 'utf8'),
  );
  if (
    project.pages.length !== files.length ||
    project.pages.some(
      (p, i) =>
        p.image.name !== files[i].name ||
        !p.recognition?.ok ||
        !String(p.recognition.backend).startsWith('wasm') ||
        !p.range?.count,
    )
  )
    throw new Error('原图、真实逐页结果或页锚点缺失');
  const counts = await page.evaluate(({ xml, pages }) => {
    const count = (x) =>
      new DOMParser()
        .parseFromString(x, 'application/xml')
        .getElementsByTagName('note').length;
    return {
      merged: count(xml),
      pages: pages.map((p) => count(p.recognition.musicXml)),
    };
  }, project);
  if (
    !counts.merged ||
    counts.merged !== counts.pages.reduce((a, b) => a + b, 0)
  )
    throw new Error('合谱音符数与真实逐页输出不一致');
  await page.getByLabel('原图页码', { exact: true }).selectOption('1');
  const expected = project.pages[1].range.start + 1;
  await page
    .locator('.selected-summary')
    .getByText(new RegExp(`第 ${expected} 小节`))
    .waitFor();
  await page.screenshot({ path: resolve(output, 'multipage.png') });
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  const report = {
    url,
    browser: browser.version(),
    elapsedMs,
    input: supplied.length
      ? 'provided local images'
      : 'same generated test score used as two input pages',
    files: files.map((f) => f.name),
    perPage: project.pages.map((p, i) => ({
      notes: counts.pages[i],
      backend: p.recognition.backend,
      durationMs: p.recognition.durationMs,
      range: p.range,
    })),
    mergedNotes: counts.merged,
    modelPreflightRequests: preflight.length,
    secondPageSelectedMeasure: expected,
    pageErrors,
    progressSeen,
  };
  await writeFile(
    resolve(output, 'verification.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  await writeFile(resolve(output, 'merged.musicxml'), project.xml);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
