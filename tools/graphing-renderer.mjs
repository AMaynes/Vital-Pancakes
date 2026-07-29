import { aggregateRecords, histogramBins, summarizeNumeric } from "./graphing-model.mjs";

/**
 * Renders supported graph specifications to an exportable, dependency-free
 * SVG string. Source records are never changed.
 */
export function renderChartSvg(records, spec, dimensions = {}) {
  const width = Math.max(480, dimensions.width || 960);
  const height = Math.max(320, dimensions.height || 560);
  const margin = { top: 56, right: 34, bottom: 68, left: 74 };
  const plot = {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };
  const palette = buildPalette(spec.accent || "#7B211A");
  const prepared = prepareRecords(records, spec);
  const body = [];

  if (["pie", "donut"].includes(spec.type)) {
    body.push(renderPie(prepared, spec, plot, palette));
  } else if (spec.type === "heatmap") {
    body.push(renderHeatmap(prepared, spec, plot, palette));
  } else {
    body.push(renderAxes(prepared, spec, plot));
    if (["line", "multi-line", "area"].includes(spec.type)) body.push(renderLines(prepared, spec, plot, palette));
    if (["bar", "grouped-bar", "stacked-bar"].includes(spec.type)) body.push(renderBars(prepared, spec, plot, palette));
    if (["scatter", "bubble"].includes(spec.type)) body.push(renderScatter(prepared, spec, plot, palette));
    if (spec.type === "histogram") body.push(renderHistogram(prepared, spec, plot, palette));
    if (spec.type === "box") body.push(renderBox(prepared, spec, plot, palette));
  }

  const title = escapeXml(spec.title || "Untitled graph");
  const description = escapeXml(`A ${spec.type} chart with ${records.length} source rows.`);
  const annotationMarkup = (spec.annotations ?? []).map((annotation, index) => (
    `<g><circle cx="${plot.x + 12}" cy="${plot.y + 18 + index * 18}" r="4" fill="${escapeXml(spec.accent || "#7B211A")}"/>`
    + `<text x="${plot.x + 23}" y="${plot.y + 22 + index * 18}" class="annotation">${escapeXml(annotation.text ?? annotation)}</text></g>`
  )).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc">`
    + `<title id="chart-title">${title}</title><desc id="chart-desc">${description}</desc>`
    + `<style>text{font-family:ui-sans-serif,system-ui,sans-serif;fill:#403d37;font-size:11px}.title{font-family:Georgia,serif;font-size:22px;font-weight:700}.axis{stroke:#817b70;stroke-width:1}.grid{stroke:#d8d2c5;stroke-width:1}.label{font-size:12px;font-weight:700}.legend{font-size:10px}.annotation{font-size:10px;font-weight:700}</style>`
    + `<rect width="${width}" height="${height}" fill="${escapeXml(spec.background || "#FFFDF8")}"/>`
    + `<text x="${margin.left}" y="32" class="title">${title}</text>`
    + body.join("")
    + annotationMarkup
    + `</svg>`;
}

export function prepareRecords(records, spec) {
  const source = records.map((record) => ({ ...record }));
  if (spec.type === "histogram") {
    return histogramBins(source.map((record) => record[spec.x]), spec.bins).map((bin) => ({
      __x: `${formatNumber(bin.x0)}–${formatNumber(bin.x1)}`,
      __y: bin.count,
      __rawX: bin.x0,
    }));
  }
  if (["pie", "donut"].includes(spec.type)) {
    if (spec.y) return aggregateRecords(source, spec.x, spec.y, spec.aggregation === "none" ? "sum" : spec.aggregation)
      .map((record) => ({ __x: record[spec.x], __y: Number(record[spec.y]) || 0 }));
    const counts = new Map();
    source.forEach((record) => counts.set(String(record[spec.x] ?? "Missing"), (counts.get(String(record[spec.x] ?? "Missing")) || 0) + 1));
    return [...counts].map(([__x, __y]) => ({ __x, __y }));
  }
  if (spec.aggregation && spec.aggregation !== "none" && spec.x && spec.y) {
    return aggregateRecords(source, spec.x, spec.y, spec.aggregation).map((record) => ({
      ...record,
      __x: record[spec.x],
      __y: Number(record[spec.y]),
      __series: "All",
    }));
  }
  return source.map((record, index) => ({
    ...record,
    __x: record[spec.x] ?? index,
    __y: Number(record[spec.y]),
    __series: spec.series ? String(record[spec.series] ?? "Missing") : "All",
    __size: spec.size ? Number(record[spec.size]) : 1,
  })).filter((record) => Number.isFinite(record.__y));
}

function renderAxes(records, spec, plot) {
  const xValues = records.map((record) => record.__x);
  const numericX = xValues.length && xValues.every((value) => Number.isFinite(Number(value)));
  const yValues = records.map((record) => record.__y).filter(Number.isFinite);
  const yDomain = extent(yValues, spec.scaleY === "log");
  const ticks = 5;
  let markup = `<line class="axis" x1="${plot.x}" y1="${plot.y + plot.height}" x2="${plot.x + plot.width}" y2="${plot.y + plot.height}"/>`
    + `<line class="axis" x1="${plot.x}" y1="${plot.y}" x2="${plot.x}" y2="${plot.y + plot.height}"/>`;
  for (let index = 0; index <= ticks; index += 1) {
    const y = plot.y + plot.height - (plot.height * index / ticks);
    const value = yDomain[0] + (yDomain[1] - yDomain[0]) * index / ticks;
    markup += `<line class="grid" x1="${plot.x}" y1="${y}" x2="${plot.x + plot.width}" y2="${y}"/>`
      + `<text x="${plot.x - 9}" y="${y + 4}" text-anchor="end">${escapeXml(formatNumber(value))}</text>`;
  }
  const labels = numericX
    ? tickValues(extent(xValues.map(Number), spec.scaleX === "log"), 6).map((value) => ({ label: formatNumber(value), value }))
    : [...new Set(xValues.map(String))].slice(0, 12).map((value, index, all) => ({ label: value, value: index, index, count: all.length }));
  labels.forEach((tick) => {
    const x = numericX
      ? scaleValue(Number(tick.value), extent(xValues.map(Number), spec.scaleX === "log"), [plot.x, plot.x + plot.width], spec.scaleX)
      : plot.x + (tick.index + 0.5) * plot.width / Math.max(1, tick.count);
    markup += `<text x="${x}" y="${plot.y + plot.height + 20}" text-anchor="middle">${escapeXml(shortLabel(tick.label))}</text>`;
  });
  markup += `<text class="label" x="${plot.x + plot.width / 2}" y="${plot.y + plot.height + 52}" text-anchor="middle">${escapeXml(spec.xLabel || spec.x || "")}</text>`
    + `<text class="label" transform="translate(${plot.x - 55} ${plot.y + plot.height / 2}) rotate(-90)" text-anchor="middle">${escapeXml(`${spec.yLabel || spec.y || "Count"}${spec.units ? ` (${spec.units})` : ""}`)}</text>`;
  return markup;
}

function renderLines(records, spec, plot, palette) {
  const groups = groupBySeries(records);
  const xScale = createXScale(records, plot, spec);
  const yScale = createYScale(records, plot, spec);
  return [...groups.entries()].map(([series, values], seriesIndex) => {
    const sorted = [...values].sort((a, b) => compareX(a.__x, b.__x));
    const points = sorted.map((record) => `${xScale(record.__x)},${yScale(record.__y)}`).join(" ");
    const color = palette[seriesIndex % palette.length];
    const area = spec.type === "area"
      ? `<polygon points="${xScale(sorted[0]?.__x)},${plot.y + plot.height} ${points} ${xScale(sorted.at(-1)?.__x)},${plot.y + plot.height}" fill="${color}" opacity=".18"/>`
      : "";
    const circles = spec.labels ? sorted.map((record) => `<circle cx="${xScale(record.__x)}" cy="${yScale(record.__y)}" r="3" fill="${color}"><title>${escapeXml(`${record.__x}: ${record.__y}`)}</title></circle>`).join("") : "";
    const legend = spec.legend !== false && groups.size > 1
      ? `<g><rect x="${plot.x + plot.width - 130}" y="${plot.y + 8 + seriesIndex * 18}" width="10" height="10" fill="${color}"/><text class="legend" x="${plot.x + plot.width - 115}" y="${plot.y + 17 + seriesIndex * 18}">${escapeXml(series)}</text></g>`
      : "";
    return `${area}<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"/>${circles}${legend}`;
  }).join("");
}

function renderBars(records, spec, plot, palette) {
  const categories = [...new Set(records.map((record) => String(record.__x)))];
  const series = [...new Set(records.map((record) => record.__series))];
  const categoryWidth = plot.width / Math.max(1, categories.length);
  const groupedWidth = spec.type === "grouped-bar" ? categoryWidth / Math.max(1, series.length) : categoryWidth;
  const yScale = createYScale(records, plot, spec, spec.type === "stacked-bar");
  const stacks = new Map();
  return records.map((record) => {
    const categoryIndex = categories.indexOf(String(record.__x));
    const seriesIndex = series.indexOf(record.__series);
    let baseline = 0;
    if (spec.type === "stacked-bar") {
      baseline = stacks.get(String(record.__x)) || 0;
      stacks.set(String(record.__x), baseline + record.__y);
    }
    const x = plot.x + categoryIndex * categoryWidth + (spec.type === "grouped-bar" ? seriesIndex * groupedWidth : categoryWidth * 0.12);
    const width = (spec.type === "grouped-bar" ? groupedWidth : categoryWidth * 0.76) - 2;
    const top = yScale(record.__y + baseline);
    const bottom = yScale(baseline);
    return `<rect x="${x}" y="${Math.min(top, bottom)}" width="${Math.max(1, width)}" height="${Math.max(1, Math.abs(bottom - top))}" fill="${palette[seriesIndex % palette.length]}"><title>${escapeXml(`${record.__x} · ${record.__series}: ${record.__y}`)}</title></rect>`;
  }).join("");
}

function renderScatter(records, spec, plot, palette) {
  const xScale = createXScale(records, plot, spec);
  const yScale = createYScale(records, plot, spec);
  const sizeValues = records.map((record) => record.__size).filter(Number.isFinite);
  const sizeDomain = extent(sizeValues);
  const groups = [...new Set(records.map((record) => record.__series))];
  return records.map((record) => {
    const radius = spec.type === "bubble" ? scaleValue(record.__size, sizeDomain, [4, 22]) : 4;
    const color = palette[Math.max(0, groups.indexOf(record.__series)) % palette.length];
    return `<circle cx="${xScale(record.__x)}" cy="${yScale(record.__y)}" r="${radius}" fill="${color}" opacity=".78" stroke="#fff" stroke-width="1"><title>${escapeXml(`${record.__x}, ${record.__y}`)}</title></circle>`;
  }).join("");
}

function renderHistogram(records, spec, plot, palette) {
  const width = plot.width / Math.max(1, records.length);
  const yScale = createYScale(records, plot, spec);
  return records.map((record, index) => {
    const y = yScale(record.__y);
    return `<rect x="${plot.x + index * width + 1}" y="${y}" width="${Math.max(1, width - 2)}" height="${plot.y + plot.height - y}" fill="${palette[0]}"><title>${escapeXml(`${record.__x}: ${record.__y}`)}</title></rect>`;
  }).join("");
}

function renderBox(records, spec, plot, palette) {
  const groups = new Map();
  records.forEach((record) => {
    if (!groups.has(record.__series)) groups.set(record.__series, []);
    groups.get(record.__series).push(record.__y);
  });
  const yScale = createYScale(records, plot, spec);
  const width = plot.width / Math.max(1, groups.size);
  return [...groups.entries()].map(([series, values], index) => {
    const stats = summarizeNumeric(values);
    const x = plot.x + (index + 0.5) * width;
    return `<line x1="${x}" y1="${yScale(stats.min)}" x2="${x}" y2="${yScale(stats.max)}" stroke="${palette[index % palette.length]}"/>`
      + `<rect x="${x - width * 0.22}" y="${yScale(stats.q3)}" width="${width * 0.44}" height="${Math.max(1, yScale(stats.q1) - yScale(stats.q3))}" fill="${palette[index % palette.length]}" opacity=".35" stroke="${palette[index % palette.length]}"/>`
      + `<line x1="${x - width * 0.22}" y1="${yScale(stats.median)}" x2="${x + width * 0.22}" y2="${yScale(stats.median)}" stroke="${palette[index % palette.length]}" stroke-width="2"/>`
      + `<text x="${x}" y="${plot.y + plot.height + 20}" text-anchor="middle">${escapeXml(shortLabel(series))}</text>`;
  }).join("");
}

function renderPie(records, spec, plot, palette) {
  const total = records.reduce((sum, record) => sum + Math.max(0, record.__y), 0) || 1;
  const centerX = plot.x + plot.width * 0.43;
  const centerY = plot.y + plot.height * 0.5;
  const radius = Math.min(plot.width, plot.height) * 0.36;
  let angle = -Math.PI / 2;
  return records.map((record, index) => {
    const next = angle + Math.max(0, record.__y) / total * Math.PI * 2;
    const large = next - angle > Math.PI ? 1 : 0;
    const start = polar(centerX, centerY, radius, angle);
    const end = polar(centerX, centerY, radius, next);
    const inner = spec.type === "donut" ? radius * 0.55 : 0;
    const path = inner
      ? donutPath(centerX, centerY, radius, inner, angle, next, large)
      : `M ${centerX} ${centerY} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y} Z`;
    angle = next;
    return `<path d="${path}" fill="${palette[index % palette.length]}" stroke="#fffdf8" stroke-width="2"><title>${escapeXml(`${record.__x}: ${record.__y}`)}</title></path>`
      + `<rect x="${plot.x + plot.width * 0.78}" y="${plot.y + 12 + index * 19}" width="11" height="11" fill="${palette[index % palette.length]}"/>`
      + `<text x="${plot.x + plot.width * 0.78 + 17}" y="${plot.y + 22 + index * 19}">${escapeXml(`${shortLabel(record.__x)} ${formatNumber(record.__y / total * 100)}%`)}</text>`;
  }).join("");
}

function renderHeatmap(records, spec, plot, palette) {
  const xCategories = [...new Set(records.map((record) => String(record.__x)))];
  const yCategories = [...new Set(records.map((record) => String(record.__series)))];
  const values = records.map((record) => record.__y);
  const domain = extent(values);
  const width = plot.width / Math.max(1, xCategories.length);
  const height = plot.height / Math.max(1, yCategories.length);
  return records.map((record) => {
    const x = xCategories.indexOf(String(record.__x));
    const y = yCategories.indexOf(String(record.__series));
    const opacity = scaleValue(record.__y, domain, [0.12, 1]);
    return `<rect x="${plot.x + x * width}" y="${plot.y + y * height}" width="${width}" height="${height}" fill="${palette[0]}" opacity="${opacity}" stroke="#fffdf8"><title>${escapeXml(`${record.__x} · ${record.__series}: ${record.__y}`)}</title></rect>`;
  }).join("")
    + xCategories.map((label, index) => `<text x="${plot.x + (index + 0.5) * width}" y="${plot.y + plot.height + 20}" text-anchor="middle">${escapeXml(shortLabel(label))}</text>`).join("")
    + yCategories.map((label, index) => `<text x="${plot.x - 9}" y="${plot.y + (index + 0.5) * height + 4}" text-anchor="end">${escapeXml(shortLabel(label))}</text>`).join("");
}

function createXScale(records, plot, spec) {
  const values = records.map((record) => record.__x);
  const numeric = values.every((value) => Number.isFinite(Number(value)));
  if (numeric) {
    const domain = extent(values.map(Number), spec.scaleX === "log");
    return (value) => scaleValue(Number(value), domain, [plot.x, plot.x + plot.width], spec.scaleX);
  }
  const categories = [...new Set(values.map(String))];
  return (value) => plot.x + (categories.indexOf(String(value)) + 0.5) * plot.width / Math.max(1, categories.length);
}

function createYScale(records, plot, spec, stacked = false) {
  let values = records.map((record) => record.__y);
  if (stacked) {
    const totals = new Map();
    records.forEach((record) => totals.set(String(record.__x), (totals.get(String(record.__x)) || 0) + Math.max(0, record.__y)));
    values = [...totals.values()];
  }
  const domain = extent([0, ...values], spec.scaleY === "log");
  return (value) => scaleValue(value, domain, [plot.y + plot.height, plot.y], spec.scaleY);
}

function groupBySeries(records) {
  const groups = new Map();
  records.forEach((record) => {
    if (!groups.has(record.__series)) groups.set(record.__series, []);
    groups.get(record.__series).push(record);
  });
  return groups;
}

function scaleValue(value, domain, range, scale = "linear") {
  if (domain[0] === domain[1]) return (range[0] + range[1]) / 2;
  let normalized;
  if (scale === "log") normalized = (Math.log(value) - Math.log(domain[0])) / (Math.log(domain[1]) - Math.log(domain[0]));
  else normalized = (value - domain[0]) / (domain[1] - domain[0]);
  return range[0] + normalized * (range[1] - range[0]);
}

function extent(values, logarithmic = false) {
  const finite = values.map(Number).filter((value) => Number.isFinite(value) && (!logarithmic || value > 0));
  if (!finite.length) return logarithmic ? [1, 10] : [0, 1];
  let minimum = Math.min(...finite);
  let maximum = Math.max(...finite);
  if (minimum === maximum) {
    const padding = Math.abs(minimum || 1) * 0.5;
    minimum = logarithmic ? Math.max(Number.MIN_VALUE, minimum / 2) : minimum - padding;
    maximum += padding;
  }
  return [minimum, maximum];
}

function tickValues(domain, count) {
  return Array.from({ length: count }, (_, index) => domain[0] + (domain[1] - domain[0]) * index / Math.max(1, count - 1));
}

function buildPalette(accent) {
  return [accent, "#2D5D68", "#B58B36", "#51764B", "#80527B", "#C85A40", "#4E6A9A", "#73706A"];
}

function compareX(a, b) {
  if (Number.isFinite(Number(a)) && Number.isFinite(Number(b))) return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function polar(cx, cy, radius, angle) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function donutPath(cx, cy, outer, inner, startAngle, endAngle, large) {
  const outerStart = polar(cx, cy, outer, startAngle);
  const outerEnd = polar(cx, cy, outer, endAngle);
  const innerStart = polar(cx, cy, inner, endAngle);
  const innerEnd = polar(cx, cy, inner, startAngle);
  return `M ${outerStart.x} ${outerStart.y} A ${outer} ${outer} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y} L ${innerStart.x} ${innerStart.y} A ${inner} ${inner} 0 ${large} 0 ${innerEnd.x} ${innerEnd.y} Z`;
}

function shortLabel(value) {
  const text = String(value ?? "");
  return text.length > 14 ? `${text.slice(0, 12)}…` : text;
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value ?? "");
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[character]);
}
