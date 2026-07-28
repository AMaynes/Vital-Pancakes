/**
 * Dependency-free bitmap tracing for black-and-white Visual Board artwork.
 *
 * Pixels are thresholded, their closed ink boundaries are followed, and the
 * resulting paths are simplified before they enter board storage.
 */

const DEFAULT_MAXIMUM_PATHS = 1800;
const DEFAULT_MAXIMUM_POINTS = 20000;

export function traceBlackAndWhiteImage(
  imageData,
  {
    threshold,
    simplification = 1.2,
    minimumArea = 1.5,
    maximumPaths = DEFAULT_MAXIMUM_PATHS,
    maximumPoints = DEFAULT_MAXIMUM_POINTS,
  } = {},
) {
  validateImageData(imageData);
  const resolvedThreshold = Number.isFinite(threshold)
    ? clamp(Math.round(threshold), 0, 255)
    : findOtsuThreshold(imageData);
  const mask = createInkMask(imageData, resolvedThreshold);
  const candidates = traceInkMask(mask, imageData.width, imageData.height)
    .map((path) => simplifyClosedPath(path, simplification))
    .filter((path) => path.length >= 3)
    .map((path) => ({ path, area: Math.abs(getSignedArea(path)) }))
    .filter(({ area }) => area >= minimumArea)
    .sort((first, second) => second.area - first.area);

  const paths = [];
  let pointCount = 0;
  for (const candidate of candidates) {
    if (paths.length >= maximumPaths) break;
    if (pointCount + candidate.path.length > maximumPoints) continue;
    paths.push(candidate.path);
    pointCount += candidate.path.length;
  }

  return {
    paths,
    threshold: resolvedThreshold,
    pointCount,
  };
}

export function findOtsuThreshold(imageData) {
  validateImageData(imageData);
  const histogram = new Uint32Array(256);
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  for (let index = 0; index < data.length; index += 4) {
    histogram[getCompositeLuminance(data, index)] += 1;
  }

  let weightedTotal = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    weightedTotal += value * histogram[value];
  }

  let backgroundWeight = 0;
  let backgroundTotal = 0;
  let bestVariance = -1;
  let bestThreshold = 128;
  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = pixelCount - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundTotal += value * histogram[value];
    const backgroundMean = backgroundTotal / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundTotal) / foregroundWeight;
    const meanDifference = backgroundMean - foregroundMean;
    const variance = backgroundWeight * foregroundWeight * meanDifference * meanDifference;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = value;
    }
  }
  return bestThreshold;
}

export function traceInkMask(mask, width, height) {
  if (!(mask instanceof Uint8Array) || mask.length !== width * height) return [];

  const edges = [];
  const outgoing = new Map();
  const addEdge = (startX, startY, endX, endY, direction) => {
    const edgeIndex = edges.length;
    edges.push({ startX, startY, endX, endY, direction });
    const key = pointKey(startX, startY);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(edgeIndex);
  };
  const isInk = (x, y) => (
    x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInk(x, y)) continue;
      if (!isInk(x, y - 1)) addEdge(x, y, x + 1, y, 0);
      if (!isInk(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1, 1);
      if (!isInk(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1, 2);
      if (!isInk(x - 1, y)) addEdge(x, y + 1, x, y, 3);
    }
  }

  const visited = new Uint8Array(edges.length);
  const contours = [];
  edges.forEach((firstEdge, firstIndex) => {
    if (visited[firstIndex]) return;
    const path = [];
    const startKey = pointKey(firstEdge.startX, firstEdge.startY);
    let edgeIndex = firstIndex;
    let closed = false;

    for (let step = 0; step <= edges.length; step += 1) {
      if (visited[edgeIndex]) break;
      const edge = edges[edgeIndex];
      visited[edgeIndex] = 1;
      path.push({ x: edge.startX, y: edge.startY });
      const endKey = pointKey(edge.endX, edge.endY);
      if (endKey === startKey) {
        closed = true;
        break;
      }
      const candidates = (outgoing.get(endKey) ?? [])
        .filter((candidateIndex) => !visited[candidateIndex]);
      if (!candidates.length) break;
      edgeIndex = candidates.reduce((bestIndex, candidateIndex) => {
        const bestRank = getTurnRank(edge.direction, edges[bestIndex].direction);
        const candidateRank = getTurnRank(edge.direction, edges[candidateIndex].direction);
        return candidateRank < bestRank ? candidateIndex : bestIndex;
      }, candidates[0]);
    }

    if (closed && path.length >= 3) contours.push(path);
  });
  return contours;
}

function createInkMask(imageData, threshold) {
  const mask = new Uint8Array(imageData.width * imageData.height);
  for (let sourceIndex = 0, maskIndex = 0;
    sourceIndex < imageData.data.length;
    sourceIndex += 4, maskIndex += 1) {
    mask[maskIndex] = getCompositeLuminance(imageData.data, sourceIndex) <= threshold ? 1 : 0;
  }
  return mask;
}

function getCompositeLuminance(data, index) {
  const alpha = data[index + 3] / 255;
  const luminance = 0.2126 * data[index]
    + 0.7152 * data[index + 1]
    + 0.0722 * data[index + 2];
  return Math.round(255 + (luminance - 255) * alpha);
}

function simplifyClosedPath(path, tolerance) {
  if (path.length <= 4 || tolerance <= 0) return path.map((point) => ({ ...point }));
  let oppositeIndex = 1;
  let maximumDistance = 0;
  for (let index = 1; index < path.length; index += 1) {
    const distance = squaredDistance(path[0], path[index]);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      oppositeIndex = index;
    }
  }
  const firstHalf = simplifyOpenPath(path.slice(0, oppositeIndex + 1), tolerance);
  const secondHalf = simplifyOpenPath(
    [...path.slice(oppositeIndex), path[0]],
    tolerance,
  );
  return [
    ...firstHalf.slice(0, -1),
    ...secondHalf.slice(0, -1),
  ];
}

function simplifyOpenPath(points, tolerance) {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const toleranceSquared = tolerance * tolerance;
  let furthestIndex = -1;
  let furthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = squaredDistanceToSegment(
      points[index],
      points[0],
      points.at(-1),
    );
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestDistance <= toleranceSquared) {
    return [{ ...points[0] }, { ...points.at(-1) }];
  }
  const first = simplifyOpenPath(points.slice(0, furthestIndex + 1), tolerance);
  const second = simplifyOpenPath(points.slice(furthestIndex), tolerance);
  return [...first.slice(0, -1), ...second];
}

function squaredDistanceToSegment(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return squaredDistance(point, start);
  const progress = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return squaredDistance(point, {
    x: start.x + progress * deltaX,
    y: start.y + progress * deltaY,
  });
}

function getSignedArea(path) {
  return path.reduce((area, point, index) => {
    const next = path[(index + 1) % path.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function getTurnRank(currentDirection, candidateDirection) {
  const turn = (candidateDirection - currentDirection + 4) % 4;
  return { 1: 0, 0: 1, 3: 2, 2: 3 }[turn];
}

function pointKey(x, y) {
  return `${x},${y}`;
}

function squaredDistance(first, second) {
  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  return deltaX * deltaX + deltaY * deltaY;
}

function validateImageData(imageData) {
  const isValid = Number.isInteger(imageData?.width)
    && imageData.width > 0
    && Number.isInteger(imageData?.height)
    && imageData.height > 0
    && imageData?.data?.length === imageData.width * imageData.height * 4;
  if (!isValid) throw new TypeError("A valid RGBA image is required for tracing.");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
