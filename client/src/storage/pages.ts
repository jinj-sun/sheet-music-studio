import type { StudioProject } from './projects';
import type { MeasureRange } from '../omr/merge-pages';

export const MAX_PAGES = 60;
export const MAX_PAGE_IMAGE_CHARS = 110_000_000;
export interface ScoreImage {
  name: string;
  dataUrl: string;
}
export interface ProjectPage {
  id: string;
  image: ScoreImage;
  recognition?: Record<string, unknown>;
  error?: string;
  range?: MeasureRange;
}
export function projectPages(project?: StudioProject | null): ProjectPage[] {
  if (project?.pages?.length) return project.pages;
  return project?.image
    ? [{ id: 'legacy', image: project.image, recognition: project.recognition }]
    : [];
}
export function pageXml(page?: ProjectPage): string | undefined {
  const raw = page?.recognition?.musicXml;
  return !page?.error &&
    page?.recognition?.ok === true &&
    typeof raw === 'string' &&
    raw
    ? raw
    : undefined;
}
export function imageIsValid(image: unknown): image is ScoreImage {
  if (!image || typeof image !== 'object') return false;
  const i = image as Partial<ScoreImage>;
  return (
    typeof i.name === 'string' &&
    typeof i.dataUrl === 'string' &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]/.test(i.dataUrl)
  );
}
export function validatePageData(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_PAGES)
    throw new Error(`项目页数无效，最多 ${MAX_PAGES} 页`);
  const ids = new Set<string>();
  let bytes = 0;
  for (const p of value) {
    if (
      !p ||
      typeof p !== 'object' ||
      typeof p.id !== 'string' ||
      !p.id ||
      ids.has(p.id) ||
      !imageIsValid(p.image) ||
      (p.error !== undefined && typeof p.error !== 'string') ||
      (p.recognition !== undefined &&
        (!p.recognition ||
          typeof p.recognition !== 'object' ||
          Array.isArray(p.recognition)))
    )
      throw new Error('项目页、原图或识别记录格式无效');
    if (
      p.range !== undefined &&
      (!p.range ||
        !Number.isInteger(p.range.start) ||
        p.range.start < 0 ||
        !Number.isInteger(p.range.count) ||
        p.range.count <= 0)
    )
      throw new Error('项目页的小节范围无效');
    ids.add(p.id);
    bytes += p.image.dataUrl.length;
  }
  if (bytes > MAX_PAGE_IMAGE_CHARS)
    throw new Error('项目原图总大小超过约 80 MB，请拆分后处理');
}
