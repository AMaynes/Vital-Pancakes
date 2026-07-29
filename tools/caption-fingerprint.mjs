/**
 * Compact same-speed audio fingerprints. These hashes are intended only for
 * matching portions of the same 1× source and are not speed invariant.
 */

const SPECTRAL_BAND_COUNT = 24;
const SPECTRAL_FRAME_COUNT = 6;
const MAXIMUM_FFT_SIZE = 2_048;
const SPECTRAL_HASH_BITS = 64;
const AGGREGATE_HASH_BITS = 48;
const bandRangeCache = new Map();

export function createAudioFingerprints(samples, {
  sampleRate = 16_000,
  startTimeMs = 0,
  windowMs = 2_000,
  stepMs = 500,
} = {}) {
  if (!(samples instanceof Float32Array)) throw new TypeError("Fingerprint samples must be Float32Array.");
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError("Sample rate must be positive.");
  const windowSamples = Math.round(sampleRate * windowMs / 1000);
  const stepSamples = Math.round(sampleRate * stepMs / 1000);
  if (samples.length < windowSamples) return [];
  const output = [];
  for (let offset = 0; offset + windowSamples <= samples.length; offset += stepSamples) {
    const slice = samples.subarray(offset, offset + windowSamples);
    if (!hasFingerprintSignal(slice)) continue;
    output.push({
      timeMs: Math.round(startTimeMs + (offset * 1000 / sampleRate)),
      hash: fingerprintWindow(slice, sampleRate),
    });
  }
  return output;
}

export function matchAudioFingerprints(query, reference, {
  predictedMs = null,
  nearbyRadiusMs = 90_000,
  threshold = 0.76,
} = {}) {
  if (!Array.isArray(query) || !Array.isArray(reference) || query.length < 2 || reference.length < 2) {
    return { match: null, confidence: 0, scope: "none" };
  }
  if (new Set(query.map((entry) => entry.hash)).size < 2) {
    return { match: null, confidence: 0, scope: "none" };
  }
  const nearby = Number.isFinite(predictedMs)
    ? reference.filter((entry) => Math.abs(entry.timeMs - predictedMs) <= nearbyRadiusMs)
    : [];
  const nearbyMatch = findBestOffsetMatch(query, nearby, threshold);
  if (nearbyMatch) return { ...nearbyMatch, scope: "nearby" };
  const globalMatch = findBestOffsetMatch(query, reference, threshold);
  if (globalMatch) return { ...globalMatch, scope: "global" };
  return { match: null, confidence: 0, scope: nearby.length ? "global" : "none" };
}

export function fingerprintSimilarity(leftHash, rightHash) {
  const left = BigInt(`0x${String(leftHash || "0")}`);
  const right = BigInt(`0x${String(rightHash || "0")}`);
  let difference = left ^ right;
  let changedBits = 0;
  while (difference) {
    changedBits += Number(difference & 1n);
    difference >>= 1n;
  }
  const bitCount = Math.max(1, Math.max(String(leftHash).length, String(rightHash).length) * 4);
  return Math.max(0, 1 - (changedBits / bitCount));
}

function fingerprintWindow(samples, sampleRate) {
  const frameSize = selectFftSize(samples.length);
  const frameCount = Math.min(
    SPECTRAL_FRAME_COUNT,
    Math.max(1, Math.floor(samples.length / frameSize)),
  );
  const maximumStart = Math.max(0, samples.length - frameSize);
  const spectralFrames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameCount === 1
      ? Math.round(maximumStart / 2)
      : Math.round(maximumStart * frameIndex / (frameCount - 1));
    spectralFrames.push(normalizedSpectralFrame(samples, start, frameSize, sampleRate));
  }
  const featureCount = spectralFrames[0]?.length ?? 0;
  if (!featureCount) return "0".repeat(SPECTRAL_HASH_BITS / 4);
  const aggregate = new Float64Array(featureCount);
  const temporal = new Float64Array(featureCount);
  const splitFrame = Math.ceil(spectralFrames.length / 2);
  for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
    let early = 0;
    let late = 0;
    for (let frameIndex = 0; frameIndex < spectralFrames.length; frameIndex += 1) {
      const value = spectralFrames[frameIndex][featureIndex];
      aggregate[featureIndex] += value / spectralFrames.length;
      if (frameIndex < splitFrame) early += value / splitFrame;
      else late += value / Math.max(1, spectralFrames.length - splitFrame);
    }
    temporal[featureIndex] = late - early;
  }

  let bits = 0n;
  for (let bitIndex = 0; bitIndex < SPECTRAL_HASH_BITS; bitIndex += 1) {
    bits <<= 1n;
    const features = bitIndex < AGGREGATE_HASH_BITS ? aggregate : temporal;
    let projection = 0;
    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
      projection += features[featureIndex] * projectionWeight(bitIndex, featureIndex);
    }
    if (projection > 0) bits |= 1n;
  }
  return bits.toString(16).padStart(SPECTRAL_HASH_BITS / 4, "0");
}

function normalizedSpectralFrame(samples, start, frameSize, sampleRate) {
  const real = new Float64Array(frameSize);
  const imaginary = new Float64Array(frameSize);
  let mean = 0;
  for (let index = 0; index < frameSize; index += 1) mean += samples[start + index];
  mean /= frameSize;
  for (let index = 0; index < frameSize; index += 1) {
    const hann = frameSize === 1
      ? 1
      : 0.5 - (0.5 * Math.cos(2 * Math.PI * index / (frameSize - 1)));
    real[index] = (samples[start + index] - mean) * hann;
  }
  fftInPlace(real, imaginary);
  const ranges = getSpectralBandRanges(frameSize, sampleRate);
  const logEnergy = new Float64Array(ranges.length);
  let average = 0;
  for (let bandIndex = 0; bandIndex < ranges.length; bandIndex += 1) {
    const [startBin, endBin] = ranges[bandIndex];
    let energy = 0;
    for (let bin = startBin; bin < endBin; bin += 1) {
      energy += (real[bin] * real[bin]) + (imaginary[bin] * imaginary[bin]);
    }
    logEnergy[bandIndex] = Math.log1p(energy / Math.max(1, endBin - startBin));
    average += logEnergy[bandIndex] / ranges.length;
  }
  let magnitude = 0;
  for (let index = 0; index < logEnergy.length; index += 1) {
    logEnergy[index] -= average;
    magnitude += logEnergy[index] * logEnergy[index];
  }
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 1e-9) {
    for (let index = 0; index < logEnergy.length; index += 1) {
      logEnergy[index] /= magnitude;
    }
  }
  return logEnergy;
}

function getSpectralBandRanges(frameSize, sampleRate) {
  const cacheKey = `${frameSize}:${sampleRate}`;
  const cached = bandRangeCache.get(cacheKey);
  if (cached) return cached;
  const finalBin = Math.max(2, Math.floor(frameSize / 2));
  const availableBins = Math.max(1, finalBin - 1);
  const bandCount = Math.min(SPECTRAL_BAND_COUNT, availableBins);
  const binWidthHz = sampleRate / frameSize;
  const minimumBin = Math.min(
    finalBin - 1,
    Math.max(1, Math.round(Math.min(80, sampleRate / 16) / binWidthHz)),
  );
  const maximumBin = Math.max(minimumBin + 1, Math.floor(finalBin * 0.95));
  const logarithmicSpan = Math.log(maximumBin / minimumBin);
  const edges = [minimumBin];
  for (let index = 1; index < bandCount; index += 1) {
    const logarithmicBin = Math.round(minimumBin * Math.exp(logarithmicSpan * index / bandCount));
    const minimumRemaining = bandCount - index;
    edges.push(Math.min(maximumBin - minimumRemaining, Math.max(edges.at(-1) + 1, logarithmicBin)));
  }
  edges.push(maximumBin);
  const ranges = edges.slice(0, -1).map((startBin, index) => [
    startBin,
    Math.max(startBin + 1, edges[index + 1]),
  ]);
  bandRangeCache.set(cacheKey, ranges);
  return ranges;
}

function selectFftSize(sampleCount) {
  const maximum = Math.max(2, Math.min(MAXIMUM_FFT_SIZE, sampleCount));
  let size = 1;
  while (size * 2 <= maximum) size *= 2;
  return Math.max(2, size);
}

function fftInPlace(real, imaginary) {
  const size = real.length;
  for (let source = 1, destination = 0; source < size; source += 1) {
    let bit = size >> 1;
    while (destination & bit) {
      destination ^= bit;
      bit >>= 1;
    }
    destination ^= bit;
    if (source < destination) {
      [real[source], real[destination]] = [real[destination], real[source]];
      [imaginary[source], imaginary[destination]] = [imaginary[destination], imaginary[source]];
    }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = -2 * Math.PI / length;
    const rotationReal = Math.cos(angle);
    const rotationImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const evenIndex = offset + index;
        const oddIndex = evenIndex + (length / 2);
        const oddReal = (real[oddIndex] * twiddleReal)
          - (imaginary[oddIndex] * twiddleImaginary);
        const oddImaginary = (real[oddIndex] * twiddleImaginary)
          + (imaginary[oddIndex] * twiddleReal);
        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;
        const nextTwiddleReal = (twiddleReal * rotationReal)
          - (twiddleImaginary * rotationImaginary);
        twiddleImaginary = (twiddleReal * rotationImaginary)
          + (twiddleImaginary * rotationReal);
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}

function projectionWeight(bitIndex, featureIndex) {
  let value = Math.imul(bitIndex + 1, 0x9e3779b1)
    ^ Math.imul(featureIndex + 1, 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value & 1) === 0 ? -1 : 1;
}

function findBestOffsetMatch(query, reference, threshold) {
  if (!reference.length) return null;
  const candidateOffsets = new Set();
  for (const queryEntry of query) {
    for (const referenceEntry of reference) {
      const similarity = fingerprintSimilarity(queryEntry.hash, referenceEntry.hash);
      if (similarity < 0.7) continue;
      const offsetBucket = Math.round((referenceEntry.timeMs - queryEntry.timeMs) / 500) * 500;
      candidateOffsets.add(offsetBucket);
    }
  }
  let best = null;
  const referenceByTime = new Map(reference.map((entry) => [
    Math.round(entry.timeMs / 500) * 500,
    entry,
  ]));
  for (const offsetMs of candidateOffsets) {
    let score = 0;
    let matches = 0;
    let previousReferenceTimeMs = -Infinity;
    for (const queryEntry of query) {
      const expectedTimeMs = Math.round((queryEntry.timeMs + offsetMs) / 500) * 500;
      const referenceEntry = referenceByTime.get(expectedTimeMs);
      if (!referenceEntry || referenceEntry.timeMs <= previousReferenceTimeMs) continue;
      const similarity = fingerprintSimilarity(queryEntry.hash, referenceEntry.hash);
      if (similarity < 0.7) continue;
      score += similarity;
      matches += 1;
      previousReferenceTimeMs = referenceEntry.timeMs;
    }
    const coverage = matches / query.length;
    if (matches < 2 || coverage < 0.6) continue;
    const confidence = (score / matches) * coverage;
    if (!best || confidence > best.confidence) {
      best = {
        confidence,
        match: { timeMs: Math.max(0, query[0].timeMs + offsetMs), offsetMs },
      };
    }
  }
  return best?.confidence >= threshold ? best : null;
}

function hasFingerprintSignal(samples) {
  let energy = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const sample of samples) {
    energy += sample * sample;
    minimum = Math.min(minimum, sample);
    maximum = Math.max(maximum, sample);
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  return rms >= 0.003 && maximum - minimum >= 0.004;
}
