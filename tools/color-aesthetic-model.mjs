/**
 * Perceptual OKLCH color conversion, harmony, seeded generation, role,
 * contrast, color-vision simulation, and clustering policies.
 */

export const PALETTE_FORMAT = "vital-pancakes-palette";
export const PALETTE_VERSION = 1;

export const HARMONIES = Object.freeze({
  complementary: [0, 180],
  analogous: [-60, -30, 0, 30, 60],
  monochromatic: [0, 0, 0, 0, 0],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  "split-complementary": [0, 150, 210],
});

export function hexToRgb(hex) {
  const normalized = String(hex).trim().replace(/^#/, "");
  const expanded = normalized.length === 3 ? normalized.split("").map((value) => value.repeat(2)).join("") : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) throw new TypeError(`Invalid hex color: ${hex}.`);
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
    g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
    b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function rgbToOklch(rgb) {
  const r = linearize(rgb.r);
  const g = linearize(rgb.g);
  const b = linearize(rgb.b);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const yellowBlue = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  const chroma = Math.sqrt(a * a + yellowBlue * yellowBlue);
  const hue = (Math.atan2(yellowBlue, a) * 180 / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: chroma < 1e-8 ? 0 : hue };
}

export function oklchToRgb({ l, c, h }) {
  const angle = h * Math.PI / 180;
  const a = c * Math.cos(angle);
  const yellowBlue = c * Math.sin(angle);
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * yellowBlue;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * yellowBlue;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * yellowBlue;
  const lLinear = lRoot ** 3;
  const mLinear = mRoot ** 3;
  const sLinear = sRoot ** 3;
  return {
    r: delinearize(4.0767416621 * lLinear - 3.3077115913 * mLinear + 0.2309699292 * sLinear),
    g: delinearize(-1.2684380046 * lLinear + 2.6097574011 * mLinear - 0.3413193965 * sLinear),
    b: delinearize(-0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.707614701 * sLinear),
  };
}

export function generateHarmony(baseHex, harmony = "analogous", style = "custom", count, seed = "") {
  const base = rgbToOklch(hexToRgb(baseHex));
  const offsets = HARMONIES[harmony] ?? HARMONIES.analogous;
  const random = createSeededRandom(seed || `${baseHex}:${harmony}:${style}`);
  const requested = Math.max(2, Math.min(12, Math.trunc(count || offsets.length)));
  return Array.from({ length: requested }, (_, index) => {
    const offset = offsets[index % offsets.length] + (index >= offsets.length ? random() * 24 - 12 : 0);
    const variation = styleAdjust(style, index, requested, random);
    const color = {
      l: clamp(base.l + variation.lightness + (harmony === "monochromatic" ? (index / Math.max(1, requested - 1) - 0.5) * 0.55 : 0), 0.08, 0.96),
      c: clamp(base.c * variation.chroma, 0.01, 0.34),
      h: (base.h + offset + variation.hue + 360) % 360,
    };
    return {
      id: `color-${index + 1}`,
      hex: gamutMappedHex(color),
      locked: false,
      role: "",
    };
  });
}

export function regenerateUnlocked(colors, options) {
  const generated = generateHarmony(options.base, options.harmony, options.style, colors.length, options.seed);
  return colors.map((color, index) => color.locked ? { ...color } : { ...generated[index], id: color.id, role: color.role });
}

export function contrastRatio(firstHex, secondHex) {
  const first = luminance(hexToRgb(firstHex));
  const second = luminance(hexToRgb(secondHex));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function assignSemanticRoles(colors) {
  if (!colors.length) return [];
  const byLightness = [...colors].sort((a, b) => rgbToOklch(hexToRgb(b.hex)).l - rgbToOklch(hexToRgb(a.hex)).l);
  const roleById = new Map();
  roleById.set(byLightness[0].id, "background");
  if (byLightness[1]) roleById.set(byLightness[1].id, "surface");
  roleById.set(byLightness.at(-1).id, "text");
  const unassigned = colors.filter((color) => !roleById.has(color.id));
  ["accent", "success", "warning", "danger"].forEach((role, index) => {
    if (unassigned[index]) roleById.set(unassigned[index].id, role);
  });
  return colors.map((color) => ({ ...color, role: roleById.get(color.id) ?? color.role }));
}

export function simulateColorVision(hex, mode) {
  const rgb = hexToRgb(hex);
  const matrices = {
    protanopia: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
    deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
    tritanopia: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
  };
  const matrix = matrices[mode];
  if (!matrix) return rgbToHex(rgb);
  return rgbToHex({
    r: matrix[0][0] * rgb.r + matrix[0][1] * rgb.g + matrix[0][2] * rgb.b,
    g: matrix[1][0] * rgb.r + matrix[1][1] * rgb.g + matrix[1][2] * rgb.b,
    b: matrix[2][0] * rgb.r + matrix[2][1] * rgb.g + matrix[2][2] * rgb.b,
  });
}

export function clusterRgbSamples(samples, clusterCount = 6, iterations = 12) {
  const points = samples
    .map((sample) => Array.isArray(sample) ? sample.slice(0, 3).map(Number) : [sample.r, sample.g, sample.b].map(Number))
    .filter((point) => point.every(Number.isFinite));
  if (!points.length) return [];
  const count = Math.max(1, Math.min(clusterCount, points.length));
  let centroids = Array.from({ length: count }, (_, index) => [...points[Math.floor(index * points.length / count)]]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const groups = Array.from({ length: count }, () => []);
    points.forEach((point) => {
      let nearest = 0;
      let distance = Infinity;
      centroids.forEach((centroid, index) => {
        const candidate = (point[0] - centroid[0]) ** 2 + (point[1] - centroid[1]) ** 2 + (point[2] - centroid[2]) ** 2;
        if (candidate < distance) {
          distance = candidate;
          nearest = index;
        }
      });
      groups[nearest].push(point);
    });
    centroids = centroids.map((centroid, index) => groups[index].length
      ? [0, 1, 2].map((channel) => groups[index].reduce((sum, point) => sum + point[channel], 0) / groups[index].length)
      : centroid);
  }
  return centroids
    .map(([r, g, b]) => rgbToHex({ r: r / 255, g: g / 255, b: b / 255 }))
    .sort();
}

export function migratePaletteProject(value) {
  if (!value || value.format !== PALETTE_FORMAT) throw new TypeError("This is not a Color Aesthetic project.");
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > PALETTE_VERSION) {
    throw new TypeError(`Unsupported palette version: ${value.version}.`);
  }
  if (!Array.isArray(value.colors) || value.colors.length < 2) throw new TypeError("A palette needs at least two colors.");
  value.colors.forEach((color) => hexToRgb(color.hex));
  return { ...structuredCloneSafe(value), version: PALETTE_VERSION, history: value.history ?? [], favorites: value.favorites ?? [] };
}

function styleAdjust(style, index, count, random) {
  const position = index / Math.max(1, count - 1);
  const styles = {
    warm: { lightness: 0, chroma: 1, hue: -10 },
    cool: { lightness: 0, chroma: 1, hue: 10 },
    muted: { lightness: 0.03, chroma: 0.5, hue: 0 },
    pastel: { lightness: 0.24, chroma: 0.5, hue: 0 },
    vibrant: { lightness: 0, chroma: 1.45, hue: 0 },
    dark: { lightness: -0.28 + position * 0.08, chroma: 0.9, hue: 0 },
    light: { lightness: 0.3 - position * 0.08, chroma: 0.6, hue: 0 },
    archival: { lightness: (position - 0.5) * 0.16, chroma: 0.55, hue: -5 },
    natural: { lightness: (random() - 0.5) * 0.12, chroma: 0.62, hue: random() * 12 - 6 },
    custom: { lightness: (position - 0.5) * 0.1, chroma: 1, hue: 0 },
  };
  return styles[style] ?? styles.custom;
}

function gamutMappedHex(oklch) {
  let candidate = { ...oklch };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rgb = oklchToRgb(candidate);
    if ([rgb.r, rgb.g, rgb.b].every((value) => value >= 0 && value <= 1)) return rgbToHex(rgb);
    candidate.c *= 0.92;
  }
  return rgbToHex(oklchToRgb(candidate));
}

function luminance(rgb) {
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

function linearize(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function delinearize(value) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055;
}

function createSeededRandom(seed) {
  let state = 0x811c9dc5;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 0x01000193);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
