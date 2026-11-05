import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyFingerings,
  readFingering,
  suggestFingerings,
} from '../../client/src/music/fingering';
import { parseScore, descendants } from '../../client/src/music/score';
import { buildTimeline } from '../../client/src/music/timeline';
const xml = readFileSync('tests/fixtures/piano-rhythm.musicxml', 'utf8');
it('suggests playable left-hand chord order without annotating ties or rests', () => {
  const score = parseScore(xml),
    result = suggestFingerings(score),
    lookup = new Map(result.suggestions.map((s) => [s.id, s.finger]));
  expect(result.suggestions.length).toBeGreaterThan(4);
  expect(lookup.has('p0m0n0')).toBe(false);
  expect(lookup.has('p0m0n4')).toBe(false);
  expect(lookup.get('p0m1n5')).toBeGreaterThan(lookup.get('p0m1n6')!);
  expect(descendants(score.document, 'fingering')).toHaveLength(0);
});
it('preserves existing fingerings and writes only explicitly selected new marks', () => {
  const existing = applyFingerings(xml, [{ id: 'p0m0n3', finger: 3 }]);
  const proposal = suggestFingerings(parseScore(existing));
  expect(proposal.suggestions.some((s) => s.id === 'p0m0n3')).toBe(false);
  const edited = applyFingerings(
    existing,
    [{ id: 'p0m0n3', finger: 5 }, proposal.suggestions[0]],
    true,
  );
  expect(readFingering(parseScore(edited).notes[3]).finger).toBe(3);
  expect(descendants(parseScore(edited).document, 'fingering')).toHaveLength(2);
  expect(buildTimeline(edited)).toEqual(buildTimeline(xml));
  expect(descendants(parseScore(edited).document, 'lyric')[0].textContent).toBe(
    '保留',
  );
});
it('manual removal preserves other technical notation, and complex substitutions are protected', () => {
  const finger = applyFingerings(xml, [{ id: 'p0m0n3', finger: 2 }]).replace(
    '<technical>',
    '<technical><harmonic/>',
  );
  const removed = applyFingerings(finger, [{ id: 'p0m0n3', finger: null }]);
  expect(descendants(parseScore(removed).document, 'harmonic')).toHaveLength(1);
  expect(descendants(parseScore(removed).document, 'fingering')).toHaveLength(
    0,
  );
  const complex = finger.replace(
    '<fingering>2',
    '<fingering substitution="yes">2',
  );
  expect(() => applyFingerings(complex, [{ id: 'p0m0n3', finger: 4 }])).toThrow(
    '换指',
  );
});
