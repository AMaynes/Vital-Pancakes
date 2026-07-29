import { coerceDataset, detectSchema, parseDelimited, parseJsonDataset } from "./graphing-model.mjs";

self.addEventListener("message", (event) => {
  const { id, text, format } = event.data ?? {};
  try {
    const parsed = format === "json" ? parseJsonDataset(text) : parseDelimited(text, format === "tsv" ? "\t" : ",");
    const schema = detectSchema(parsed);
    self.postMessage({ id, ok: true, dataset: coerceDataset(parsed, schema), schema });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
});
