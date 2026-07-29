import { clusterRgbSamples } from "./color-aesthetic-model.mjs";

self.addEventListener("message", (event) => {
  const { id, samples, count } = event.data ?? {};
  try {
    self.postMessage({ id, ok: true, colors: clusterRgbSamples(samples, count) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
});
