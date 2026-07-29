/**
 * Deterministic parsing, type inference, transformations, statistics, chart
 * validation, and project migration for Graphing Tool.
 */

export const GRAPH_PROJECT_FORMAT = "vital-pancakes-graph";
export const GRAPH_PROJECT_VERSION = 1;

export const CHART_TYPES = Object.freeze([
  "line", "multi-line", "bar", "grouped-bar", "stacked-bar", "scatter",
  "bubble", "area", "histogram", "box", "pie", "donut", "heatmap",
]);

export function parseDelimited(text, delimiter = ",") {
  if (typeof text !== "string") throw new TypeError("Delimited input must be text.");
  if (!delimiter || delimiter.length !== 1) throw new TypeError("Delimiter must be one character.");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new TypeError("Delimited data contains an unclosed quoted field.");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "") || rows.length === 0) rows.push(row);
  const headers = uniqueHeaders(rows.shift() ?? []);
  if (!headers.length || headers.every((header) => !header)) throw new TypeError("The table needs a header row.");
  const invalidRows = [];
  const records = rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values, index) => {
      if (values.length !== headers.length) invalidRows.push({ row: index + 2, expected: headers.length, actual: values.length });
      return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    });
  return { headers, records, invalidRows };
}

export function parseJsonDataset(text) {
  let value;
  try {
    value = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new TypeError("The JSON data is malformed.");
  }
  const records = Array.isArray(value) ? value : value?.records;
  if (!Array.isArray(records)) throw new TypeError("JSON data must be an array of objects or an object with a records array.");
  if (!records.every((record) => record && typeof record === "object" && !Array.isArray(record))) {
    throw new TypeError("Every JSON row must be an object.");
  }
  const headers = uniqueHeaders(records.flatMap((record) => Object.keys(record)));
  return { headers, records: records.map((record) => Object.fromEntries(headers.map((header) => [header, scalar(record[header])]))), invalidRows: [] };
}

export function detectColumnType(values) {
  const present = values.filter((value) => value !== "" && value !== null && value !== undefined);
  if (!present.length) return "empty";
  const numeric = present.filter((value) => Number.isFinite(Number(String(value).replaceAll(",", ""))));
  if (numeric.length / present.length >= 0.9) return "number";
  const dates = present.filter((value) => !Number.isNaN(Date.parse(String(value))) && /[-/:]/.test(String(value)));
  if (dates.length / present.length >= 0.9) return "date";
  const booleanValues = new Set(present.map((value) => String(value).toLowerCase()));
  if ([...booleanValues].every((value) => ["true", "false", "yes", "no", "0", "1"].includes(value))) return "boolean";
  const unique = new Set(present.map(String));
  return unique.size <= Math.min(30, Math.ceil(present.length * 0.45)) ? "category" : "text";
}

export function detectSchema(dataset) {
  return Object.fromEntries(dataset.headers.map((header) => [
    header,
    detectColumnType(dataset.records.map((record) => record[header])),
  ]));
}

export function coerceDataset(dataset, schema) {
  const invalid = [];
  const records = dataset.records.map((source, rowIndex) => {
    const record = {};
    dataset.headers.forEach((header) => {
      const value = source[header];
      const type = schema[header] ?? "text";
      if (value === "" || value === null || value === undefined) {
        record[header] = null;
      } else if (type === "number") {
        const number = Number(String(value).replaceAll(",", ""));
        record[header] = Number.isFinite(number) ? number : null;
        if (!Number.isFinite(number)) invalid.push({ row: rowIndex + 2, column: header, value });
      } else if (type === "date") {
        const date = new Date(value);
        record[header] = Number.isNaN(date.getTime()) ? null : date.toISOString();
        if (record[header] === null) invalid.push({ row: rowIndex + 2, column: header, value });
      } else if (type === "boolean") {
        record[header] = ["true", "yes", "1"].includes(String(value).toLowerCase());
      } else {
        record[header] = String(value);
      }
    });
    return record;
  });
  return { headers: [...dataset.headers], records, invalidRows: [...(dataset.invalidRows ?? []), ...invalid] };
}

export function applyTransformations(records, transformations) {
  return transformations.reduce((current, transform) => {
    if (transform.type === "filter") {
      return current.filter((record) => compare(record[transform.column], transform.operator, transform.value));
    }
    if (transform.type === "sort") {
      return [...current].sort((a, b) => compareValues(a[transform.column], b[transform.column]) * (transform.direction === "desc" ? -1 : 1));
    }
    if (transform.type === "limit") return current.slice(0, Math.max(0, Math.trunc(transform.count)));
    if (transform.type === "derive") {
      return current.map((record) => ({ ...record, [transform.as]: deriveValue(record, transform) }));
    }
    return current;
  }, records.map((record) => ({ ...record })));
}

export function aggregateRecords(records, groupColumn, valueColumn, operation = "sum") {
  const groups = new Map();
  records.forEach((record) => {
    const key = String(record[groupColumn] ?? "Missing");
    if (!groups.has(key)) groups.set(key, []);
    const value = Number(record[valueColumn]);
    if (Number.isFinite(value)) groups.get(key).push(value);
  });
  return [...groups.entries()].map(([group, values]) => ({
    [groupColumn]: group,
    [valueColumn]: aggregate(values, operation),
    __count: values.length,
  }));
}

export function histogramBins(values, requestedBins) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return [];
  const minimum = numbers[0];
  const maximum = numbers.at(-1);
  const binCount = Math.max(1, Math.min(100, Math.trunc(requestedBins || Math.ceil(Math.sqrt(numbers.length)))));
  if (minimum === maximum) return [{ x0: minimum, x1: maximum, count: numbers.length, values: numbers }];
  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    x0: minimum + index * width,
    x1: index === binCount - 1 ? maximum : minimum + (index + 1) * width,
    count: 0,
    values: [],
  }));
  numbers.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor((value - minimum) / width));
    bins[index].count += 1;
    bins[index].values.push(value);
  });
  return bins;
}

export function summarizeNumeric(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return { count: 0, missing: values.length };
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length;
  return {
    count: numbers.length,
    missing: values.length - numbers.length,
    min: numbers[0],
    max: numbers.at(-1),
    mean,
    median: quantile(numbers, 0.5),
    q1: quantile(numbers, 0.25),
    q3: quantile(numbers, 0.75),
    standardDeviation: Math.sqrt(variance),
  };
}

export function validateChartSpec(spec, records = []) {
  const errors = [];
  const warnings = [];
  if (!CHART_TYPES.includes(spec.type)) errors.push("Choose a supported chart type.");
  if (!spec.x && spec.type !== "histogram") errors.push("Choose an X or category column.");
  if (!spec.y && !["pie", "donut", "histogram"].includes(spec.type)) errors.push("Choose a Y value column.");
  if (spec.scaleX === "log" && records.some((record) => Number(record[spec.x]) <= 0)) errors.push("Logarithmic X scales require values greater than zero.");
  if (spec.scaleY === "log" && records.some((record) => Number(record[spec.y]) <= 0)) errors.push("Logarithmic Y scales require values greater than zero.");
  if (["pie", "donut"].includes(spec.type)) {
    const categories = new Set(records.map((record) => record[spec.x])).size;
    if (categories > 7) warnings.push("Pie and donut charts become difficult to compare with more than seven slices.");
    if (!spec.y) warnings.push("Pie and donut charts will count rows because no numeric value column is selected.");
  }
  if (spec.type === "bubble" && !spec.size) errors.push("Bubble charts require a size column.");
  if (spec.type === "heatmap" && !spec.series) errors.push("Heatmaps require a second category column.");
  return { valid: errors.length === 0, errors, warnings };
}

export function migrateGraphProject(value) {
  if (!value || value.format !== GRAPH_PROJECT_FORMAT) throw new TypeError("This is not a Graphing Tool project.");
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > GRAPH_PROJECT_VERSION) {
    throw new TypeError(`Unsupported graph project version: ${value.version}.`);
  }
  if (!value.dataset || !Array.isArray(value.dataset.headers) || !Array.isArray(value.dataset.records)) {
    throw new TypeError("The project dataset is invalid.");
  }
  return {
    ...structuredCloneSafe(value),
    version: GRAPH_PROJECT_VERSION,
    transformations: Array.isArray(value.transformations) ? value.transformations : [],
    spec: { type: "line", scaleX: "linear", scaleY: "linear", ...value.spec },
  };
}

export function createGraphProject(dataset, schema = detectSchema(dataset)) {
  return {
    format: GRAPH_PROJECT_FORMAT,
    version: GRAPH_PROJECT_VERSION,
    title: "Untitled graph",
    dataset: structuredCloneSafe(dataset),
    schema: structuredCloneSafe(schema),
    transformations: [],
    spec: {
      type: "line", x: dataset.headers[0] ?? "", y: dataset.headers[1] ?? "",
      series: "", size: "", aggregation: "none", bins: 10, scaleX: "linear", scaleY: "linear",
      title: "", xLabel: "", yLabel: "", units: "", legend: true, labels: false,
      accent: "#7b211a", background: "#fffdf8", annotations: [],
    },
  };
}

function aggregate(values, operation) {
  if (!values.length) return null;
  if (operation === "count") return values.length;
  if (operation === "mean") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (operation === "min") return Math.min(...values);
  if (operation === "max") return Math.max(...values);
  if (operation === "median") return quantile([...values].sort((a, b) => a - b), 0.5);
  return values.reduce((sum, value) => sum + value, 0);
}

function quantile(sorted, proportion) {
  const position = (sorted.length - 1) * proportion;
  const base = Math.floor(position);
  const remainder = position - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + remainder * (sorted[base + 1] - sorted[base]);
}

function compare(value, operator, target) {
  const left = typeof value === "number" ? value : String(value ?? "");
  const right = typeof value === "number" ? Number(target) : String(target ?? "");
  if (operator === "equals") return left === right;
  if (operator === "not-equals") return left !== right;
  if (operator === "contains") return String(left).toLowerCase().includes(String(right).toLowerCase());
  if (operator === "greater") return left > right;
  if (operator === "less") return left < right;
  if (operator === "missing") return value === null || value === undefined || value === "";
  return true;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a > b ? 1 : -1;
}

function deriveValue(record, transform) {
  const value = Number(record[transform.column]);
  const operand = Number(transform.operand);
  if (!Number.isFinite(value) || !Number.isFinite(operand)) return null;
  if (transform.operator === "add") return value + operand;
  if (transform.operator === "subtract") return value - operand;
  if (transform.operator === "multiply") return value * operand;
  if (transform.operator === "divide") return operand === 0 ? null : value / operand;
  return value;
}

function uniqueHeaders(headers) {
  const used = new Map();
  return headers.map((raw, index) => {
    const base = String(raw ?? "").trim() || `Column ${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count ? `${base} (${count + 1})` : base;
  });
}

function scalar(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : value;
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
