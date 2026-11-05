import { logger } from '@lark-apaas/client-toolkit/logger';
import type { OpenSheetMusicDisplay as OSMDType, IOSMDOptions, Cursor } from 'opensheetmusicdisplay';

let osmdInstance: OSMDType | null = null;
let cursorInstance: Cursor | null = null;
let cursorEnabled: boolean = false;

const OSMD_OPTIONS: IOSMDOptions = {
  autoResize: true,
  backend: 'svg',
  drawTitle: true,
  drawSubtitle: true,
  drawComposer: true,
  drawLyricist: true,
  drawPartNames: true,
  followCursor: true,
};

export async function renderMusicXml(musicXml: string, container: HTMLElement): Promise<void> {
  if (!container) {
    throw new Error('容器元素不存在');
  }

  container.innerHTML = '';
  cursorInstance = null;
  cursorEnabled = false;

  try {
    const OSMDModule = await import('opensheetmusicdisplay');
    const OSMDClass = OSMDModule.OpenSheetMusicDisplay;

    if (!osmdInstance) {
      osmdInstance = new OSMDClass(container, OSMD_OPTIONS);
    }

    await osmdInstance.load(musicXml);
    osmdInstance.render();

    logger.info('MusicXML 渲染成功');
  } catch (err) {
    logger.error('OSMD 渲染失败', err);
    container.innerHTML = `
      <div class="text-red-500 text-center py-8">
        <p class="font-medium">渲染失败</p>
        <p class="text-sm mt-2 text-red-400">${err instanceof Error ? err.message : String(err)}</p>
        <p class="text-xs mt-4 text-slate-500">请检查 MusicXML 格式是否正确</p>
      </div>
    `;
    throw err;
  }
}

export function enableCursor(): void {
  if (!osmdInstance) return;
  try {
    osmdInstance.enableOrDisableCursors(true);
    osmdInstance.cursor.show();
    osmdInstance.cursor.reset();
    cursorInstance = osmdInstance.cursor;
    cursorEnabled = true;
    logger.info('播放光标已启用');
  } catch (err) {
    logger.error('启用光标失败', err);
  }
}

export function disableCursor(): void {
  if (!osmdInstance) return;
  try {
    if (cursorInstance) {
      cursorInstance.hide();
    }
    osmdInstance.enableOrDisableCursors(false);
    cursorEnabled = false;
    cursorInstance = null;
  } catch (err) {
    logger.error('禁用光标失败', err);
  }
}

export function resetCursor(): void {
  if (!cursorInstance) return;
  try {
    cursorInstance.reset();
    cursorInstance.update();
  } catch (err) {
    logger.error('重置光标失败', err);
  }
}

export function advanceCursor(): boolean {
  if (!cursorInstance) return false;
  try {
    if (cursorInstance.hidden) {
      cursorInstance.show();
    }
    cursorInstance.next();
    cursorInstance.update();
    return true;
  } catch (err) {
    return false;
  }
}

export function isCursorEnabled(): boolean {
  return cursorEnabled;
}

export function getOsmdInstance(): OSMDType | null {
  return osmdInstance;
}

export function cleanupRenderer(): void {
  osmdInstance = null;
  cursorInstance = null;
  cursorEnabled = false;
}
