/**
 * Pure helpers for the optional per-range colors stored on Visual Board
 * textboxes. Ranges use textarea-style UTF-16 offsets: start inclusive, end
 * exclusive.
 */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function sanitizeTextColorRanges(ranges, textLength) {
  const maximum = Math.max(0, Math.floor(Number(textLength) || 0));
  if (!Array.isArray(ranges) || maximum === 0) return [];

  return mergeAdjacentRanges(ranges
    .filter((range) => range && typeof range === "object" && HEX_COLOR.test(range.color))
    .map((range) => ({
      start: clampOffset(range.start, maximum),
      end: clampOffset(range.end, maximum),
      color: range.color.toLowerCase(),
    }))
    .filter((range) => range.end > range.start)
    .sort((first, second) => first.start - second.start || first.end - second.end)
    .reduce((result, range) => overlayColorRange(result, range), []));
}

export function applyTextColorRange(ranges, textLength, start, end, color) {
  const maximum = Math.max(0, Math.floor(Number(textLength) || 0));
  const normalizedColor = typeof color === "string" && HEX_COLOR.test(color)
    ? color.toLowerCase()
    : null;
  const nextRange = {
    start: clampOffset(start, maximum),
    end: clampOffset(end, maximum),
    color: normalizedColor,
  };
  const existing = sanitizeTextColorRanges(ranges, maximum);
  if (!normalizedColor || nextRange.end <= nextRange.start) return existing;
  return mergeAdjacentRanges(overlayColorRange(existing, nextRange));
}

export function updateTextColorRangesForEdit(ranges, previousText, nextText) {
  const previous = String(previousText ?? "");
  const next = String(nextText ?? "");
  const existing = sanitizeTextColorRanges(ranges, previous.length);
  if (previous === next || !existing.length) return existing;

  let commonPrefix = 0;
  while (
    commonPrefix < previous.length
    && commonPrefix < next.length
    && previous[commonPrefix] === next[commonPrefix]
  ) {
    commonPrefix += 1;
  }

  let commonSuffix = 0;
  while (
    commonSuffix < previous.length - commonPrefix
    && commonSuffix < next.length - commonPrefix
    && previous[previous.length - 1 - commonSuffix] === next[next.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1;
  }

  const previousEditEnd = previous.length - commonSuffix;
  const nextEditEnd = next.length - commonSuffix;
  const offsetDelta = nextEditEnd - previousEditEnd;
  const adjusted = [];

  existing.forEach((range) => {
    if (range.end <= commonPrefix) {
      adjusted.push(range);
      return;
    }
    if (range.start >= previousEditEnd) {
      adjusted.push({
        ...range,
        start: range.start + offsetDelta,
        end: range.end + offsetDelta,
      });
      return;
    }
    if (range.start < commonPrefix) {
      adjusted.push({ ...range, end: commonPrefix });
    }
    if (range.end > previousEditEnd) {
      adjusted.push({
        ...range,
        start: nextEditEnd,
        end: range.end + offsetDelta,
      });
    }
  });

  return sanitizeTextColorRanges(adjusted, next.length);
}

export function getTextColorSegments(text, textStart, ranges, baseColor) {
  const value = String(text ?? "");
  if (!value) return [];
  const offset = Math.max(0, Math.floor(Number(textStart) || 0));
  const normalizedRanges = sanitizeTextColorRanges(ranges, offset + value.length)
    .filter((range) => range.start < offset + value.length && range.end > offset);
  const boundaries = new Set([0, value.length]);
  normalizedRanges.forEach((range) => {
    boundaries.add(Math.max(0, range.start - offset));
    boundaries.add(Math.min(value.length, range.end - offset));
  });
  const ordered = [...boundaries].sort((first, second) => first - second);

  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1];
    const globalOffset = offset + start;
    const activeRange = normalizedRanges.find((range) => (
      range.start <= globalOffset && range.end > globalOffset
    ));
    return {
      text: value.slice(start, end),
      color: activeRange?.color ?? baseColor,
    };
  }).filter((segment) => segment.text);
}

function overlayColorRange(ranges, nextRange) {
  const retained = [];
  ranges.forEach((range) => {
    if (range.end <= nextRange.start || range.start >= nextRange.end) {
      retained.push(range);
      return;
    }
    if (range.start < nextRange.start) {
      retained.push({ ...range, end: nextRange.start });
    }
    if (range.end > nextRange.end) {
      retained.push({ ...range, start: nextRange.end });
    }
  });
  retained.push(nextRange);
  return retained.sort((first, second) => first.start - second.start || first.end - second.end);
}

function mergeAdjacentRanges(ranges) {
  return ranges.reduce((result, range) => {
    const previous = result.at(-1);
    if (previous?.color === range.color && previous.end === range.start) {
      previous.end = range.end;
    } else {
      result.push({ ...range });
    }
    return result;
  }, []);
}

function clampOffset(value, maximum) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(maximum, Math.max(0, Math.floor(numericValue)));
}
