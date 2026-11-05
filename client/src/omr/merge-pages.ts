import { child, kids, make, parseScore, serialize } from '../music/score';

export interface MeasureRange {
  start: number;
  count: number;
}

function signature(element: Element): string {
  return JSON.stringify([
    element.namespaceURI,
    element.localName,
    Array.from(element.attributes)
      .map((a) => [a.namespaceURI, a.localName, a.value])
      .sort(),
    Array.from(element.childNodes).flatMap((node) =>
      node.nodeType === 1
        ? [signature(node as Element)]
        : node.nodeType === 3 && node.textContent?.trim()
          ? [node.textContent.trim()]
          : [],
    ),
  ]);
}

function declaredIds(root: Element) {
  const references = new Set([
    'part',
    'instrument',
    'midi-instrument',
    'midi-device',
    'play',
    'listen',
  ]);
  return [root, ...Array.from(root.getElementsByTagName('*'))].flatMap((e) => {
    const xmlId = e.getAttributeNS(
      'http://www.w3.org/XML/1998/namespace',
      'id',
    );
    const id = xmlId || (!references.has(e.localName) && e.getAttribute('id'));
    return id ? [id] : [];
  });
}

/** Merge original measures, never regenerate music from the note projection. */
export function mergeRecognizedPages(xmlPages: string[]): {
  xml: string;
  ranges: MeasureRange[];
} {
  if (!xmlPages.length) throw new Error('没有可合并的识别页');
  const pages = xmlPages.map((xml, i) => {
    try {
      const score = parseScore(xml);
      if (score.readonly || !score.notes.length)
        throw new Error('没有可编辑的 partwise 音符');
      if (
        xmlPages.length > 1 &&
        (!score.parts[0].measures.length ||
          score.parts.some(
            (p) => p.measures.length !== score.parts[0].measures.length,
          ))
      )
        throw new Error('各乐器小节数不同，无法确定跨页对齐');
      return score;
    } catch (e) {
      throw new Error(
        `第 ${i + 1} 页：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
  if (pages.length === 1)
    return {
      xml: xmlPages[0],
      ranges: [{ start: 0, count: pages[0].parts[0].measures.length }],
    };
  const first = parseScore(xmlPages[0]);
  const root = first.document.documentElement,
    partList = child(root, 'part-list'),
    targetParts = kids(root, 'part');
  if (
    !partList ||
    new Set(first.parts.map((p) => p.id)).size !== first.parts.length
  )
    throw new Error('第 1 页缺少唯一的乐器定义，无法安全合并');
  const reference = signature(partList),
    ids = new Set<string>();
  for (const id of declaredIds(root)) {
    if (ids.has(id)) throw new Error(`第 1 页存在重复 XML ID：${id}`);
    ids.add(id);
  }
  const ranges: MeasureRange[] = [];
  let start = 0;
  for (const [i, page] of pages.entries()) {
    const incoming = page.document.documentElement,
      list = child(incoming, 'part-list');
    if (
      incoming.namespaceURI !== root.namespaceURI ||
      incoming.getAttribute('version') !== root.getAttribute('version') ||
      !list ||
      signature(list) !== reference ||
      page.parts.length !== first.parts.length ||
      page.parts.some((p, j) => p.id !== first.parts[j].id)
    )
      throw new Error(
        `第 ${i + 1} 页的 MusicXML 版本或乐器定义与第 1 页不一致，已保留每页结果`,
      );
    if (
      i > 0 &&
      page.parts.some(
        (p, j) =>
          p.measures[0].staffCount !==
          pages[i - 1].parts[j].measures.at(-1)!.staffCount,
      )
    )
      throw new Error(
        `第 ${i + 1} 页的谱表数与前页不一致，请确认是否为同一首曲子`,
      );
    const count = page.parts[0].measures.length;
    ranges.push({ start, count });
    for (const [partIndex, part] of kids(incoming, 'part').entries()) {
      if (kids(part).some((e) => e.localName !== 'measure'))
        throw new Error(`第 ${i + 1} 页的 part 包含无法安全搬移的扩展`);
      for (const [j, source] of kids(part, 'measure').entries()) {
        const measure =
          i === 0
            ? first.parts[partIndex].measures[j].element
            : first.document.importNode(source, true);
        measure.setAttribute('number', String(start + j + 1));
        if (i > 0) {
          for (const id of declaredIds(measure)) {
            if (ids.has(id))
              throw new Error(
                `第 ${i + 1} 页包含重复 XML ID：${id}，请先在单页 XML 中修正`,
              );
            ids.add(id);
          }
          if (j === 0) {
            const layout = child(measure, 'print') || make(measure, 'print');
            layout.setAttribute('new-page', 'yes');
            if (!layout.parentNode)
              measure.insertBefore(layout, measure.firstChild);
            // Each engine document starts with divisions=1 until it declares its own value.
            const elements = kids(measure);
            const firstTimed = elements.findIndex((e) =>
              ['note', 'backup', 'forward'].includes(e.localName),
            );
            const opening =
              firstTimed < 0 ? elements : elements.slice(0, firstTimed);
            if (
              !opening.some(
                (e) => e.localName === 'attributes' && child(e, 'divisions'),
              )
            ) {
              const attributes = make(measure, 'attributes');
              attributes.appendChild(make(attributes, 'divisions', '1'));
              measure.insertBefore(attributes, measure.firstChild);
            }
          }
          targetParts[partIndex].appendChild(measure);
        }
      }
    }
    start += count;
  }
  const xml = serialize(first),
    merged = parseScore(xml);
  for (const [i, page] of pages.entries()) {
    const range = ranges[i];
    for (const [pi, part] of page.parts.entries()) {
      for (const [j, a] of part.measures.entries()) {
        const b = merged.parts[pi].measures[range.start + j];
        if (
          !b ||
          a.nominal !== b.nominal ||
          a.duration !== b.duration ||
          a.notes.length !== b.notes.length ||
          a.notes.some((n, k) => {
            const m = b.notes[k];
            return (
              n.midi !== m.midi ||
              n.duration !== m.duration ||
              n.onset !== m.onset ||
              n.staff !== m.staff ||
              n.voice !== m.voice
            );
          })
        )
          throw new Error(
            `第 ${i + 1} 页的小节 ${a.number} 跨页继承后音高或节奏变化，无法安全合并。请确认拍号、移调及 divisions`,
          );
      }
    }
  }
  return { xml, ranges };
}
