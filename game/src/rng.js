// rng.js — a tiny seeded random generator (mulberry32) plus helpers.
// The whole city is generated from one seed so a given ?seed= always builds the
// same Port Marisol, which keeps screenshots and saves reproducible.
window.PM = window.PM || {};

PM.makeRng = function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
    pick(list) { return list[Math.floor(next() * list.length) % list.length]; },
    chance(p) { return next() < p; },
  };
};

/** Clamp `value` into [min, max]. */
PM.clamp = function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
};

/** Linear interpolation. */
PM.lerp = function lerp(a, b, t) {
  return a + (b - a) * t;
};

/** Shortest-path angle interpolation (radians), so headings turn the short way. */
PM.lerpAngle = function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** Horizontal distance between two {x, z} points. */
PM.dist2d = function dist2d(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
};

/** Read a query parameter from the page URL (used for ?seed= and ?shot=). */
PM.queryParam = function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
};
