import { parseScore } from '../music/score';
import type { ImportedScore } from './files';
export interface StudioProject {
  schema: 1;
  id: string;
  title: string;
  xml: string;
  originalXml: string;
  draft: string;
  updatedAt: number;
  source?: ImportedScore;
  image?: { name: string; dataUrl: string };
  recognition?: Record<string, unknown>;
  checked: string[];
}
export function newProject(xml: string, title?: string): StudioProject {
  return {
    schema: 1,
    id: crypto.randomUUID(),
    title: title || (xml ? parseScore(xml).title : '图片识谱'),
    xml,
    originalXml: xml,
    draft: xml,
    updatedAt: Date.now(),
    checked: [],
  };
}
export function parseProject(input: string): StudioProject {
  if (input.length > 150_000_000) throw new Error('项目文件超过 150 MB');
  const value: unknown = JSON.parse(input);
  if (!value || typeof value !== 'object') throw new Error('项目文件格式无效');
  const p = value as Partial<StudioProject>;
  if (
    p.schema !== 1 ||
    typeof p.xml !== 'string' ||
    typeof p.title !== 'string' ||
    typeof p.originalXml !== 'string' ||
    typeof p.draft !== 'string' ||
    !Array.isArray(p.checked) ||
    p.checked.some((c) => typeof c !== 'string')
  )
    throw new Error('项目版本或必要字段无效');
  if (p.xml) parseScore(p.xml);
  if (p.originalXml) parseScore(p.originalXml);
  if (
    p.image &&
    (typeof p.image.name !== 'string' ||
      typeof p.image.dataUrl !== 'string' ||
      !/^data:image\/(png|jpeg|webp);base64,/.test(p.image.dataUrl))
  )
    throw new Error('项目原图格式无效');
  if (
    p.source &&
    (typeof p.source.xml !== 'string' ||
      typeof p.source.originalData !== 'string' ||
      typeof p.source.sourceName !== 'string' ||
      (p.source.archive !== undefined && typeof p.source.archive !== 'string'))
  )
    throw new Error('项目导入来源无效');
  // Import as a new project: existing browser projects can never be overwritten by file IDs.
  return {
    ...p,
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
  } as StudioProject;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('puxie-studio-v2', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('无法访问浏览器项目库'));
    request.onblocked = () =>
      reject(new Error('项目库升级被其他标签页占用，请关闭其他工作台标签页'));
  });
}
async function operation<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode);
    const request = run(tx.objectStore('projects'));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(
        tx.error || request.error || new Error('保存失败，请下载项目备份'),
      );
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('保存中断，请下载项目备份'));
    };
  });
}
export async function saveProject(project: StudioProject): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite'),
      store = tx.objectStore('projects');
    const existing = store.get(project.id);
    existing.onsuccess = () => {
      // A delayed autosave must not overwrite a more recent committed snapshot.
      if (!existing.result || existing.result.updatedAt <= project.updatedAt)
        store.put(project);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('保存失败，请下载项目备份'));
    };
  });
}
export const listProjects = async () =>
  (
    await operation<StudioProject[]>('readonly', (store) => store.getAll())
  ).sort((a, b) => b.updatedAt - a.updatedAt);
