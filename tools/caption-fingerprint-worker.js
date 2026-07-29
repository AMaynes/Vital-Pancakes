/**
 * Fingerprint generation and same-speed matching worker. Accelerated captures
 * never use this path; their display synchronization uses rolling ASR text.
 */

import {
  createAudioFingerprints,
  matchAudioFingerprints,
} from "./caption-fingerprint.mjs";

let referenceFingerprints = [];

self.addEventListener("message", ({ data }) => {
  try {
    if (data?.type === "set-reference") {
      referenceFingerprints = Array.isArray(data.fingerprints) ? data.fingerprints : [];
      self.postMessage({ type: "reference-ready", count: referenceFingerprints.length });
      return;
    }
    if (data?.type === "fingerprint") {
      const samples = new Float32Array(data.samples);
      const fingerprints = createAudioFingerprints(samples, {
        sampleRate: data.sampleRate,
        startTimeMs: data.startTimeMs,
      });
      self.postMessage({ type: "fingerprint-result", jobId: data.jobId, fingerprints });
      return;
    }
    if (data?.type === "match") {
      const samples = new Float32Array(data.samples);
      const query = createAudioFingerprints(samples, {
        sampleRate: data.sampleRate,
        startTimeMs: 0,
      });
      const result = matchAudioFingerprints(query, referenceFingerprints, {
        predictedMs: data.predictedMs,
      });
      self.postMessage({
        type: "fingerprint-match",
        jobId: data.jobId,
        result,
        queryStartTimeMs: query[0]?.timeMs ?? 0,
      });
    }
  } catch (error) {
    self.postMessage({
      type: "fingerprint-error",
      jobId: data?.jobId,
      message: String(error?.message ?? "Audio fingerprinting failed."),
    });
  }
});
