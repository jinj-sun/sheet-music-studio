import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const fixture = resolve('tests/fixtures/complex.musicxml');
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
async function create(page: Page) {
  await page
    .getByRole('button', { name: '新建钢琴谱', exact: true })
    .first()
    .click();
  await expect(page.getByTestId('score-paper').locator('svg')).toBeVisible();
}
test('welcome, piano creation, SVG selection, pitch, chord, undo/redo and persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByRole('heading', { name: /从一张乐谱/ })).toBeVisible();
  await create(page);
  await expect(page.getByText('8 个记谱音符')).toBeVisible();
  await page.getByLabel('音名', { exact: true }).selectOption('C');
  await page.getByRole('button', { name: '应用音高 / 替换休止符' }).click();
  await expect(
    page.getByTestId('score-paper').locator('[data-note-id="p0m0n0"]'),
  ).toBeVisible();
  await page.getByLabel('音名', { exact: true }).selectOption('E');
  await page.getByRole('button', { name: '添加和弦音', exact: true }).click();
  await expect(page.getByText('9 个记谱音符')).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByText('8 个记谱音符')).toBeVisible();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByText('9 个记谱音符')).toBeVisible();
  await page
    .getByTestId('score-paper')
    .locator('[data-note-id="p0m0n1"]')
    .click();
  await expect(page.getByLabel('音名', { exact: true })).toHaveValue('E');
  await page.getByRole('button', { name: '标记已校对', exact: true }).click();
  await expect(page.getByText('1 / 9 已校对')).toBeVisible();
  await expect(
    page.getByText('已保存到此浏览器', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('9 个记谱音符')).toBeVisible();
  await expect(page.getByText('1 / 9 已校对')).toBeVisible();
  expect(errors).toEqual([]);
});
test('XML draft errors preserve applied score and survive refresh', async ({
  page,
}) => {
  await create(page);
  await page.getByRole('tab', { name: 'XML 源码' }).click();
  const editor = page.getByRole('textbox', { name: 'MusicXML 源码' }),
    original = await editor.inputValue();
  await editor.fill('<score-partwise>');
  await page.getByRole('button', { name: '应用 XML 修改' }).click();
  await expect(page.getByRole('alert')).toContainText('语法错误');
  await expect(page.getByText('8 个记谱音符')).toBeVisible();
  await expect(
    page.getByText('已保存到此浏览器', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'XML 源码' }).click();
  await expect(editor).toHaveValue('<score-partwise>');
  await page.getByRole('button', { name: '恢复已应用版本' }).click();
  await expect(editor).toHaveValue(original);
});
test('complex import preserves original file and guards approximate MIDI', async ({
  page,
}) => {
  await page.getByTestId('score-file-input').setInputFiles(fixture);
  await expect(page.getByTestId('score-paper').locator('svg')).toBeVisible();
  await expect(page.locator('[data-note-id="p0m1n1"]')).toBeVisible();
  await expect(page.getByText('试听 / MIDI 存在解释限制')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeDisabled();
  await page.getByText('导出', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: '导出 MIDI', exact: true }),
  ).toBeDisabled();
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载原始乐谱', exact: true }).click();
  const original = await originalDownload;
  const originalPath = await original.path();
  expect(readFileSync(originalPath!)).toEqual(readFileSync(fixture));
  await page.getByRole('checkbox', { name: /我已了解/ }).check();
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeEnabled();
  await page.getByText('导出', { exact: true }).click();
  const midiDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 MIDI', exact: true }).click();
  const midi = await midiDownload;
  expect(
    readFileSync((await midi.path())!)
      .subarray(0, 4)
      .toString(),
  ).toBe('MThd');
});
test('real OMR worker, OpenCV and WASM runtime initialize without models', async ({
  page,
}) => {
  await page.getByRole('button', { name: '引擎与模型设置' }).click();
  await page
    .getByRole('button', { name: '检查引擎运行时', exact: true })
    .click();
  await expect(page.getByText(/运行时已就绪：wasm/)).toBeVisible({
    timeout: 35000,
  });
});
test('sample playback can pause, seek, change speed, stop and export XML', async ({
  page,
}) => {
  await page.getByRole('button', { name: '加载示例乐谱', exact: true }).click();
  await expect(page.getByTestId('score-paper').locator('svg')).toBeVisible();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number(await page.getByLabel('播放进度', { exact: true }).inputValue()),
    )
    .toBeGreaterThan(0);
  await page.getByLabel('播放速度', { exact: true }).fill('150');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByLabel('播放进度', { exact: true }).fill('2');
  await expect(page.getByLabel('播放进度', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByLabel('播放进度', { exact: true })).toHaveValue('0');
  await page.getByText('导出', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出 MusicXML', exact: true })
    .click();
  const file = await pending;
  expect(readFileSync((await file.path())!, 'utf8')).toContain(
    '<score-partwise',
  );
});

test('OMR-style eighth notes beam without changing XML, and both hands highlight in sampled piano playback', async ({
  page,
}) => {
  const failures: string[] = [],
    samples: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/audio/piano/') && r.ok()) samples.push(r.url());
  });
  await page
    .getByTestId('score-file-input')
    .setInputFiles(resolve('tests/fixtures/piano-rhythm.musicxml'));
  const paper = page.getByTestId('score-paper');
  await expect(paper.locator('[data-note-id]')).toHaveCount(16);
  expect(await paper.locator('.vf-beam').count()).toBeGreaterThan(0);
  await page.getByLabel('播放速度', { exact: true }).fill('60');
  await page.getByLabel('播放进度', { exact: true }).fill('1.1');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  for (const id of ['p0m0n3', 'p0m0n4']) {
    const note = paper.locator(`[data-note-id="${id}"]`);
    await expect(note).toHaveClass(/playing-note/);
    const path = note.locator('path').first();
    expect(await path.evaluate((e) => getComputedStyle(e).fill)).toBe(
      'rgb(216, 139, 48)',
    );
  }
  expect(samples.length).toBeGreaterThan(1);
  await page.screenshot({ path: 'docs/screenshots/piano-playback.png' });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(paper.locator('.playing-note')).toHaveCount(0);
  await page.getByLabel('播放进度', { exact: true }).fill('6.1');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(paper.locator('.playing-note')).toHaveCount(3);
  for (const id of ['p0m1n1', 'p0m1n5', 'p0m1n6'])
    await expect(paper.locator(`[data-note-id="${id}"]`)).toHaveClass(
      /playing-note/,
    );
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('导出', { exact: true }).click();
  const exported = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出 MusicXML', exact: true })
    .click();
  expect(readFileSync((await (await exported).path())!, 'utf8')).toBe(
    readFileSync('tests/fixtures/piano-rhythm.musicxml', 'utf8'),
  );
  expect(failures).toEqual([]);
});

test('manual beams and ripple correction are editable, undoable and retain the other hand', async ({
  page,
}) => {
  await page
    .getByTestId('score-file-input')
    .setInputFiles(resolve('tests/fixtures/piano-rhythm.musicxml'));
  const paper = page.getByTestId('score-paper');
  await expect(paper.locator('[data-note-id="p0m0n3"]')).toBeVisible();
  await paper.locator('[data-note-id="p0m0n3"]').click();
  await page
    .getByRole('button', { name: '与下一音符连梁', exact: true })
    .click();
  await expect(
    page.getByText('已与下一音连梁，音高与时值保持不变', { exact: true }),
  ).toBeVisible();
  await paper.locator('[data-note-id="p0m0n6"]').click();
  await page.getByLabel('附点', { exact: true }).selectOption('0');
  await page.getByLabel('时值修改方式', { exact: true }).selectOption('ripple');
  await page.getByRole('button', { name: '应用时值', exact: true }).click();
  await page.getByRole('tab', { name: 'XML 源码', exact: true }).click();
  let xml = await page
    .getByLabel('MusicXML 源码', { exact: true })
    .inputValue();
  expect(xml).toContain('<beam number="1">begin</beam>');
  const timing = await page.evaluate((xml) => {
    const d = new DOMParser().parseFromString(xml, 'text/xml');
    return [...d.querySelectorAll('measure')][0]
      .querySelectorAll('note')[6]
      .querySelector('duration')!.textContent;
  }, xml);
  expect(timing).toBe('240');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  xml = await page.getByLabel('MusicXML 源码', { exact: true }).inputValue();
  expect(xml).toContain('<duration>360</duration>');
});

test('missing piano samples stop playback with an explicit error and allow retry', async ({
  page,
}) => {
  await page.getByRole('button', { name: '加载示例乐谱', exact: true }).click();
  await page.route('**/audio/piano/*.mp3', (r) =>
    r.fulfill({ status: 404, body: '' }),
  );
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('钢琴采样');
  await expect(
    page.getByRole('button', { name: '播放', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('播放进度', { exact: true })).toHaveValue('0');
  await page.unroute('**/audio/piano/*.mp3');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '停止', exact: true }).click();
});
test('image comparison, independent zoom and truthful missing-model error', async ({
  page,
}) => {
  // Always exercise missing-model behavior even on machines that have installed models.
  await page.route('**/models/**', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await create(page);
  await page.getByTestId('image-file-input').setInputFiles({
    name: 'scan.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB98AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(
    page.getByRole('img', { name: '乐谱原图', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: '乐谱编辑区' })).toBeVisible();
  await page.getByRole('button', { name: '放大原图' }).click();
  await expect(page.getByText('125%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '识别为新项目', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未执行识别');
  await expect(page.getByText('8 个记谱音符')).toBeVisible();
  await page.getByRole('button', { name: '引擎与模型设置' }).click();
  await expect(
    page.getByRole('heading', { name: '识谱引擎与模型' }),
  ).toBeVisible();
  await expect(page.locator('.model-list li')).toHaveCount(7);
});
test('mobile library, editor and inspector remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  await expect(
    page.getByRole('complementary', { name: '音符属性面板' }),
  ).toBeVisible();
  await page.getByLabel('音名', { exact: true }).selectOption('G');
  await page.getByRole('button', { name: '应用音高 / 替换休止符' }).click();
  await expect(
    page.getByRole('button', {
      name: '选择 G4 小节1 谱表1 声部1 第1音',
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '项目库', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '你的乐谱项目' }),
  ).toBeVisible();
});
test('tie, slur, rhythm, insertion, extra voice and project/MXL round-trip', async ({
  page,
}) => {
  await create(page);
  await page.getByRole('button', { name: '应用音高 / 替换休止符' }).click();
  await page.getByRole('button', { name: '下一音符', exact: true }).click();
  await page.getByRole('button', { name: '应用音高 / 替换休止符' }).click();
  await page.locator('[data-note-id="p0m0n0"]').click();
  await page.getByRole('button', { name: '与下一同音连接延音线' }).click();
  await expect(
    page.getByRole('button', { name: '解除延音线', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '解除延音线', exact: true }).click();
  await page.getByRole('button', { name: '设为连奏线起点' }).click();
  await page.getByRole('button', { name: '下一音符', exact: true }).click();
  await page.getByRole('button', { name: '连接 / 解除终点' }).click();
  await page.getByRole('button', { name: '删除当前音符' }).click();
  await expect(page.getByRole('alert')).toContainText('连线');
  await page.locator('[data-note-id="p0m0n0"]').click();
  await page.getByLabel('音符时值', { exact: true }).selectOption('eighth');
  await page.getByRole('button', { name: '应用时值', exact: true }).click();
  await page.getByRole('button', { name: '插入音符', exact: true }).click();
  await page.getByLabel('插入起点', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: '插入到空拍', exact: true }).click();
  await expect(page.getByText('9 个记谱音符')).toBeVisible();
  await page.getByLabel('插入声部', { exact: true }).fill('3');
  await page.getByLabel('插入谱表', { exact: true }).selectOption('2');
  await page.getByLabel('插入起点', { exact: true }).fill('0');
  await page.getByRole('button', { name: '插入到空拍', exact: true }).click();
  await expect(page.getByText('10 个记谱音符')).toBeVisible();
  await page.getByText('导出', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await page
    .locator('.menu-popover')
    .getByRole('button', { name: '下载项目备份', exact: true })
    .click();
  const backup = await pending;
  await page.getByTestId('score-file-input').setInputFiles({
    name: backup.suggestedFilename(),
    mimeType: 'application/json',
    buffer: readFileSync((await backup.path())!),
  });
  await expect(page.getByText('项目已导入为独立副本')).toBeVisible();
  await expect(page.getByText('10 个记谱音符')).toBeVisible();
  await page.getByText('导出', { exact: true }).click();
  const mxlPending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '导出 MXL（含附件）', exact: true })
    .click();
  const mxl = await mxlPending;
  await page.getByTestId('score-file-input').setInputFiles({
    name: mxl.suggestedFilename(),
    mimeType: 'application/vnd.recordare.musicxml',
    buffer: readFileSync((await mxl.path())!),
  });
  await expect(page.getByText('10 个记谱音符')).toBeVisible();
  await expect(page.locator('[data-note-id="p0m0n9"]')).toBeVisible();
});
