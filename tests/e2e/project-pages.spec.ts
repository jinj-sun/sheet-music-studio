import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const xml = readFileSync('tests/fixtures/piano-rhythm.musicxml', 'utf8');
const image = readFileSync('docs/screenshots/reference.png');
const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
const cachedPage = (id: string, musicXml: string) => ({
  id,
  image: { name: `page-${id}.png`, dataUrl },
  recognition: { ok: true, engine: 'test-fixture', musicXml, staves: [] },
});
const backup = (pages: unknown[], score = '') => ({
  name: 'work.studio.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      schema: 1,
      title: '多页测试曲',
      xml: score,
      originalXml: score,
      draft: score,
      checked: [],
      pages,
    }),
  ),
});

test('multi-file upload sorts page numbers naturally, allows reordering, and retains originals on missing models', async ({
  page,
}) => {
  await page.route('**/models/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await page.getByTestId('image-file-input').setInputFiles([
    { name: 'page-10.png', mimeType: 'image/png', buffer: image },
    { name: 'page-2.png', mimeType: 'image/png', buffer: image },
  ]);
  const picker = page.getByLabel('原图页码', { exact: true });
  await expect(picker.locator('option').first()).toHaveText(/page-2.png/);
  await picker.selectOption('1');
  await page.getByText('页序与结果 · 待识别', { exact: true }).click();
  await page.getByRole('button', { name: '向前移动本页', exact: true }).click();
  await expect(picker.locator('option').first()).toHaveText(/page-10.png/);
  await page
    .getByRole('button', { name: '识别全部 2 页', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('未执行识别');
  await expect(picker.locator('option')).toHaveCount(2);
  await expect(
    page.getByText('已保存到此浏览器', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(picker.locator('option').first()).toHaveText(/page-10.png/);
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.selectOption('1');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('merges saved page results, jumps to the right measure, and preserves page data through trash/restore', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const second = xml.replace('<text>保留</text>', '<text>第二页</text>');
  await page.goto('/');
  await page
    .getByTestId('score-file-input')
    .setInputFiles(backup([cachedPage('1', xml), cachedPage('2', second)]));
  await page
    .getByRole('button', { name: '合并 2 页为新项目', exact: true })
    .click();
  await expect(page.getByText(/2 页已按页序合谱/)).toBeVisible();
  await expect(
    page.getByTestId('score-paper').locator('[data-note-id]'),
  ).toHaveCount(32);
  await page.getByRole('button', { name: '下一页原图', exact: true }).click();
  await expect(page.locator('.selected-summary')).toContainText('第 3 小节');
  await page.getByRole('tab', { name: 'XML 源码', exact: true }).click();
  const merged = await page
    .getByLabel('MusicXML 源码', { exact: true })
    .inputValue();
  expect(merged).toContain('new-page="yes"');
  expect(merged).toContain('第二页');
  await page.getByRole('button', { name: '项目库', exact: true }).click();
  const title = '多页测试曲 · 2 页合谱';
  await page
    .getByRole('button', { name: `删除项目 ${title}`, exact: true })
    .click();
  await expect(page.getByText(/已移到废纸篓，可在项目库恢复/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '项目库', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `删除项目 ${title}`, exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '废纸篓（1）', exact: true }).click();
  await page
    .getByRole('button', { name: `恢复项目 ${title}`, exact: true })
    .click();
  await expect(page.getByText(/已恢复到项目库/)).toBeVisible();
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.locator('.project-card').filter({ hasText: title }).click();
  await expect(
    page.getByLabel('原图页码', { exact: true }).locator('option'),
  ).toHaveCount(2);
  await page.getByRole('tab', { name: 'XML 源码', exact: true }).click();
  await expect(page.getByLabel('MusicXML 源码', { exact: true })).toHaveValue(
    merged,
  );
  expect(errors).toEqual([]);
});

test('does not create a partial total when page structures conflict and can download the intact page', async ({
  page,
}) => {
  const other = xml.replace(
    '<part-name>Piano</part-name>',
    '<part-name>Violin</part-name>',
  );
  await page.goto('/');
  await page
    .getByTestId('score-file-input')
    .setInputFiles(backup([cachedPage('1', xml), cachedPage('2', other)]));
  await page
    .getByRole('button', { name: '合并 2 页为新项目', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('第 2 页');
  await expect(page.getByTestId('score-paper')).toHaveCount(0);
  await page.getByLabel('原图页码', { exact: true }).selectOption('1');
  await page.getByText(/页序与结果 · 已识别/).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载本页 XML', exact: true }).click();
  expect(readFileSync((await (await download).path())!, 'utf8')).toBe(other);
});

test('shows manual fingering and only attaches the checked suggestions, with undo and XML persistence', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByTestId('score-file-input')
    .setInputFiles('tests/fixtures/piano-rhythm.musicxml');
  const score = page.getByTestId('score-paper');
  await score.locator('[data-note-id="p0m0n3"]').click();
  await page.getByText('钢琴指法', { exact: true }).click();
  await page.getByLabel('当前音符指法', { exact: true }).selectOption('3');
  await page.getByRole('button', { name: '应用当前指法', exact: true }).click();
  await expect(
    score.locator('svg text').filter({ hasText: /^3$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: '生成指法建议', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '附上所选指法', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '取消全选', exact: true }).click();
  const first = page.getByRole('checkbox', { name: /^指法建议 p/ }).first();
  await first.check();
  await page.screenshot({ path: 'docs/screenshots/fingering-preview.png' });
  await page.getByRole('button', { name: '附上所选指法', exact: true }).click();
  await expect(
    page.getByText('已附上 1 条所选指法，可撤销', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'XML 源码', exact: true }).click();
  const editor = page.getByLabel('MusicXML 源码', { exact: true });
  expect((await editor.inputValue()).match(/<fingering>/g)).toHaveLength(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await editor.inputValue()).match(/<fingering>/g)).toHaveLength(1);
  await expect(
    page.getByText('已保存到此浏览器', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'XML 源码', exact: true }).click();
  await expect(editor).toHaveValue(/<fingering>3<\/fingering>/);
});
