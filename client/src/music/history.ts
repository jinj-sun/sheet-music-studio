export interface History {
  past: string[];
  present: string;
  future: string[];
}
export const createHistory = (xml: string): History => ({
  past: [],
  present: xml,
  future: [],
});
export function pushHistory(h: History, xml: string): History {
  return xml === h.present
    ? h
    : { past: [...h.past, h.present].slice(-100), present: xml, future: [] };
}
export function undo(h: History): History {
  return h.past.length
    ? {
        past: h.past.slice(0, -1),
        present: h.past.at(-1)!,
        future: [h.present, ...h.future],
      }
    : h;
}
export function redo(h: History): History {
  return h.future.length
    ? {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
      }
    : h;
}
