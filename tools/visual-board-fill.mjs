/**
 * Pure paint-bucket geometry for closed objects and connected vector regions.
 */

import {
  distanceBetween,
  getObjectSegments,
  pointHitsObject,
} from "./visual-board-geometry.mjs?v=13";

const DIRECT_FILL_TYPES = new Set([
  "rectangle",
  "ellipse",
  "area",
  "wall",
  "symbol",
]);

export function canReceiveBucketFill(object) {
  return DIRECT_FILL_TYPES.has(object?.type);
}

export function findBucketFillTarget(objects, point) {
  return [...(objects ?? [])]
    .reverse()
    .find((object) => (
      canReceiveBucketFill(object)
      && pointHitsObject(object, point, 0)
    )) ?? null;
}

export function findEnclosedVectorRegion(
  objects,
  point,
  { mergeTolerance = 0.5, maximumSegments = 12_000 } = {},
) {
  const segments = (objects ?? [])
    .filter((object) => object?.semantic?.role !== "bucket-fill-region")
    .flatMap((object) => getObjectSegments(object))
    .filter(([start, end]) => (
      isFinitePoint(start)
      && isFinitePoint(end)
      && distanceBetween(start, end) > mergeTolerance
    ));
  if (!segments.length || segments.length > maximumSegments) return null;

  const graph = buildEndpointGraph(segments, Math.max(0.001, mergeTolerance));
  const candidates = traceFaces(graph)
    .map(removeCollinearPoints)
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => ({ polygon, area: signedPolygonArea(polygon) }))
    .filter(({ area }) => area > mergeTolerance * mergeTolerance)
    .filter(({ polygon }) => pointInPolygon(point, polygon))
    .sort((first, second) => first.area - second.area);
  return candidates[0]?.polygon ?? null;
}

export function createBucketFillArea(polygon, color, createIdentifier) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  if (typeof createIdentifier !== "function") return null;
  const xValues = polygon.map((point) => point.x);
  const yValues = polygon.map((point) => point.y);
  const x = Math.min(...xValues);
  const y = Math.min(...yValues);
  const w = Math.max(...xValues) - x;
  const h = Math.max(...yValues) - y;
  if (w <= 0 || h <= 0) return null;
  return {
    id: createIdentifier(),
    type: "area",
    x,
    y,
    w,
    h,
    rotation: 0,
    vertices: polygon.map((point) => ({
      x: (point.x - x) / w,
      y: (point.y - y) / h,
    })),
    color,
    fillColor: color,
    fillOpacity: 1,
    opacity: 1,
    strokeWidth: 0.05,
    dashPattern: "solid",
    zIndex: -10_000,
    locked: false,
    semantic: {
      role: "bucket-fill-region",
      generatedBy: "paint-bucket",
    },
  };
}

function buildEndpointGraph(segments, tolerance) {
  const vertices = [];
  const cells = new Map();
  const edges = new Set();

  function getVertexIndex(point) {
    const column = Math.floor(point.x / tolerance);
    const row = Math.floor(point.y / tolerance);
    let closestIndex = null;
    let closestDistance = Infinity;
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const key = `${column + xOffset}:${row + yOffset}`;
        (cells.get(key) ?? []).forEach((index) => {
          const distance = distanceBetween(vertices[index], point);
          if (distance <= tolerance && distance < closestDistance) {
            closestIndex = index;
            closestDistance = distance;
          }
        });
      }
    }
    if (closestIndex !== null) return closestIndex;
    const index = vertices.length;
    vertices.push({ x: point.x, y: point.y, neighbors: new Set() });
    const key = `${column}:${row}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(index);
    return index;
  }

  segments.forEach(([start, end]) => {
    const first = getVertexIndex(start);
    const second = getVertexIndex(end);
    if (first === second) return;
    const edgeKey = first < second ? `${first}:${second}` : `${second}:${first}`;
    if (edges.has(edgeKey)) return;
    edges.add(edgeKey);
    vertices[first].neighbors.add(second);
    vertices[second].neighbors.add(first);
  });
  return vertices;
}

function traceFaces(vertices) {
  const visited = new Set();
  const faces = [];
  vertices.forEach((vertex, start) => {
    vertex.neighbors.forEach((next) => {
      const startKey = `${start}:${next}`;
      if (visited.has(startKey)) return;
      const polygon = [];
      let previous = start;
      let current = next;
      const maximumSteps = Math.max(4, vertices.length * 2);

      for (let step = 0; step < maximumSteps; step += 1) {
        const directedKey = `${previous}:${current}`;
        if (visited.has(directedKey)) break;
        visited.add(directedKey);
        polygon.push({ x: vertices[previous].x, y: vertices[previous].y });

        const neighbors = [...vertices[current].neighbors].sort((first, second) => (
          angleFrom(vertices[current], vertices[first])
          - angleFrom(vertices[current], vertices[second])
        ));
        const reverseIndex = neighbors.indexOf(previous);
        if (reverseIndex < 0 || neighbors.length < 2) break;
        const following = neighbors[
          (reverseIndex - 1 + neighbors.length) % neighbors.length
        ];
        previous = current;
        current = following;
        if (previous === start && current === next) {
          faces.push(polygon);
          break;
        }
      }
    });
  });
  return faces;
}

function removeCollinearPoints(polygon) {
  return polygon.filter((point, index) => {
    const previous = polygon[(index - 1 + polygon.length) % polygon.length];
    const next = polygon[(index + 1) % polygon.length];
    const cross = (point.x - previous.x) * (next.y - point.y)
      - (point.y - previous.y) * (next.x - point.x);
    return Math.abs(cross) > 1e-7;
  });
}

function signedPolygonArea(polygon) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const crosses = (start.y > point.y) !== (end.y > point.y)
      && point.x < (end.x - start.x) * (point.y - start.y)
        / (end.y - start.y) + start.x;
    if (crosses) inside = !inside;
  });
  return inside;
}

function angleFrom(origin, point) {
  return Math.atan2(point.y - origin.y, point.x - origin.x);
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
