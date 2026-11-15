import featuresJson from '../config/features.json';
import missionsJson from '../config/missions.json';
import targetsJson from '../config/targets.json';
import analogsJson from '../config/analogs.json';
import limitsJson from '../config/limits.json';

export const features = featuresJson.features;
export const groups = featuresJson.groups;
export const F = Object.fromEntries(features.map((f) => [f.id, f]));
export const systems = missionsJson.systems;
export const tests = Object.fromEntries(systems.flatMap((s) => s.tests.map((t) => [t.id, { ...t, system: s.id }])));
export const S = Object.fromEntries(systems.map((s) => [s.id, s]));
export const targets = targetsJson.targets;
export const T = Object.fromEntries(targets.map((t) => [t.id, t]));
export const analogs = analogsJson.sites;
export const A = Object.fromEntries(analogs.map((a) => [a.id, a]));
export const limits = limitsJson;
export const sources = missionsJson.sources || {};

export const catalog = { F, tests, T, A, features, limits };

export const BODY = {
  earth: { label: 'Earth', radiusKm: 6371.0, g: 1.0 },
  moon: { label: 'Moon', radiusKm: 1737.4, g: 0.166 },
  mars: { label: 'Mars', radiusKm: 3389.5, g: 0.379 },
};

export const DEFAULT = { targetId: 'connecting-ridge', testId: 'ltv.wheels' };

/** Role of each feature for a test, before user overrides. */
export function baseRole(test, fid) {
  if (test.target[fid]) return 'target';
  if (test.interference[fid]) return 'interference';
  return 'ignore';
}

export function testsFor(body) {
  return Object.values(tests).filter((t) => t.bodies.includes(body));
}
