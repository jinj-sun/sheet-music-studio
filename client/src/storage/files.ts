import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { parseScore, descendants } from '../music/score';
export interface ImportedScore {
  xml: string;
  sourceName: string;
  originalData: string;
  archive?: string;
  rootPath?: string;
  warnings: string[];
}
export const toBase64 = (data: Uint8Array) => {
  let s = '';
  for (let i = 0; i < data.length; i += 8192)
    s += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(s);
};
export const fromBase64 = (data: string) =>
  Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
function decodeXml(bytes: Uint8Array) {
  let encoding = 'utf-8';
  if (
    (bytes[0] === 255 && bytes[1] === 254) ||
    (bytes[0] === 60 && bytes[1] === 0)
  )
    encoding = 'utf-16le';
  else if (
    (bytes[0] === 254 && bytes[1] === 255) ||
    (bytes[0] === 0 && bytes[1] === 60)
  )
    encoding = 'utf-16be';
  else
    encoding =
      new TextDecoder()
        .decode(bytes.subarray(0, 200))
        .match(/encoding=["']([^"']+)["']/i)?.[1] || encoding;
  const xml = new TextDecoder(encoding, { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, '');
  return xml.replace(/(<\?xml[^?]*encoding=["'])[^"']+(["'])/i, '$1UTF-8$2');
}
export function unpackMxl(bytes: Uint8Array) {
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      count++;
      if (total > 100 * 1024 * 1024 || count > 5000)
        throw new Error('压缩谱解压后超过 100 MB 或文件过多');
      if (
        entry.name.includes('..') ||
        entry.name.startsWith('/') ||
        entry.name.includes('\\')
      )
        throw new Error('压缩谱包含不安全路径');
      return true;
    },
  });
  const container = files['META-INF/container.xml'];
  if (!container)
    throw new Error(
      'MXL 缺少 META-INF/container.xml，无法确定主乐谱；未转换或覆盖原文件',
    );
  const doc = new DOMParser().parseFromString(
    strFromU8(container),
    'application/xml',
  );
  if (descendants(doc, 'parsererror').length)
    throw new Error('MXL container.xml 无效');
  const roots = descendants(doc, 'rootfile');
  const rootPath =
    roots
      .find(
        (r) =>
          r.getAttribute('media-type') ===
          'application/vnd.recordare.musicxml+xml',
      )
      ?.getAttribute('full-path') || roots[0]?.getAttribute('full-path');
  if (!rootPath || !files[rootPath]) throw new Error('MXL 主乐谱路径不存在');
  return { files, rootPath, xml: decodeXml(files[rootPath]) };
}
export async function importScoreFile(file: File): Promise<ImportedScore> {
  if (file.size > 30 * 1024 * 1024)
    throw new Error('文件超过 30 MB，请拆分后导入');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const originalData = toBase64(bytes);
  if (/\.mxl$/i.test(file.name) || (bytes[0] === 80 && bytes[1] === 75)) {
    const { xml, rootPath, files } = unpackMxl(bytes);
    parseScore(xml);
    return {
      xml,
      sourceName: file.name,
      originalData,
      archive: originalData,
      rootPath,
      warnings:
        Object.keys(files).length > 2
          ? [
              'MXL 中的附件已保留。导出 MXL 或项目文件可携带附件；MusicXML 导出仅包含主 XML。',
            ]
          : [],
    };
  }
  const xml = decodeXml(bytes);
  parseScore(xml);
  return { xml, sourceName: file.name, originalData, warnings: [] };
}
export function exportMxl(xml: string, originalArchive?: string) {
  if (originalArchive) {
    const { files, rootPath } = unpackMxl(fromBase64(originalArchive));
    files[rootPath] = strToU8(xml);
    return zipSync(files);
  }
  return zipSync({
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
    ),
    'score.musicxml': strToU8(xml),
  });
}
export function download(
  data: string | Uint8Array,
  name: string,
  type = 'application/octet-stream',
) {
  const content = typeof data === 'string' ? data : new Uint8Array(data).buffer;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[<>:"/\\|?*]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function imageDataUrl(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('支持 PNG、JPEG、WebP 图片；PDF/TIFF/HEIC 请先转为 PNG');
  if (file.size > 25 * 1024 * 1024) throw new Error('图片超过 25 MB，请先缩小');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () =>
        reject(new Error('图片无法解码，请转为 PNG 后重试'));
      image.onload = () => {
        if (image.width * image.height > 40_000_000)
          reject(new Error('图片超过 4000 万像素，请先缩小'));
        else resolve(String(reader.result));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
