import { MAX_ANIMATION_FRAMES } from "./visual-board-animation.mjs?v=1";

export class FrameInterpolationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "FrameInterpolationError";
    this.code = code;
  }
}

export function normalizeIntermediateFrameCount(
  value,
  maximum = MAX_ANIMATION_FRAMES,
) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new FrameInterpolationError(
      "INVALID_FRAME_COUNT",
      "Choose at least one intermediate frame.",
    );
  }
  if (count > maximum) {
    throw new FrameInterpolationError(
      "FRAME_LIMIT",
      `Only ${maximum} more frame${maximum === 1 ? "" : "s"} can be added.`,
    );
  }
  return count;
}

export function getIntermediateTimesteps(count) {
  const normalizedCount = normalizeIntermediateFrameCount(count);
  return Array.from(
    { length: normalizedCount },
    (_, index) => (index + 1) / (normalizedCount + 1),
  );
}

export function insertIntermediateFrames(
  frames,
  startFrameId,
  endFrameId,
  intermediateFrames,
) {
  const startIndex = frames.findIndex((frame) => frame.id === startFrameId);
  if (startIndex < 0 || frames[startIndex + 1]?.id !== endFrameId) {
    throw new FrameInterpolationError(
      "FRAME_PAIR_CHANGED",
      "Those source frames are no longer adjacent. Choose the pair again.",
    );
  }
  if (!intermediateFrames.length) {
    throw new FrameInterpolationError(
      "INVALID_FRAME_COUNT",
      "No intermediate frames were generated.",
    );
  }

  const existingIds = new Set(frames.map((frame) => frame.id));
  const generatedIds = new Set();
  for (const frame of intermediateFrames) {
    if (!frame?.id || existingIds.has(frame.id) || generatedIds.has(frame.id)) {
      throw new FrameInterpolationError(
        "INVALID_GENERATED_FRAME",
        "An intermediate frame has an invalid or duplicate identifier.",
      );
    }
    generatedIds.add(frame.id);
  }

  return [
    ...frames.slice(0, startIndex + 1),
    ...intermediateFrames,
    ...frames.slice(startIndex + 1),
  ];
}

export async function assertWebGpuSupported({
  navigatorRef = globalThis.navigator,
} = {}) {
  if (!navigatorRef?.gpu?.requestAdapter) {
    throw new FrameInterpolationError(
      "WEBGPU_UNSUPPORTED",
      "WebGPU is unavailable. Use a current Chrome or Edge browser with hardware acceleration enabled.",
    );
  }

  let adapter;
  try {
    adapter = await navigatorRef.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
  } catch (error) {
    throw new FrameInterpolationError(
      "WEBGPU_UNSUPPORTED",
      "The browser could not access a WebGPU adapter. Check hardware acceleration and try again.",
      { cause: error },
    );
  }
  if (!adapter) {
    throw new FrameInterpolationError(
      "WEBGPU_UNSUPPORTED",
      "No compatible WebGPU adapter was found. Check hardware acceleration and try again.",
    );
  }
  return adapter;
}

export function assertFrameFitsWebGpu(width, height, limits = {}) {
  const inputBytes = width * height * 6 * Float32Array.BYTES_PER_ELEMENT;
  const maximumBufferBytes = Math.min(
    finiteLimit(limits.maxBufferSize),
    finiteLimit(limits.maxStorageBufferBindingSize),
  );
  const maximumTextureSize = finiteLimit(limits.maxTextureDimension2D);
  if (
    inputBytes > maximumBufferBytes
    || width > maximumTextureSize
    || height > maximumTextureSize
  ) {
    throw new FrameInterpolationError(
      "GPU_MEMORY",
      "These frames are too large for this GPU. Resize the source images smaller and try again.",
    );
  }
}

export async function generateIntermediateFrameImages({
  count,
  interpolateAt,
  signal,
  onProgress = () => {},
}) {
  const timesteps = getIntermediateTimesteps(count);
  const generated = [];

  for (const [index, timestep] of timesteps.entries()) {
    throwIfInterpolationCancelled(signal);
    const image = await interpolateAt(timestep, {
      index,
      total: timesteps.length,
      signal,
    });
    throwIfInterpolationCancelled(signal);
    if (
      !image
      || typeof image.dataUrl !== "string"
      || !image.dataUrl.startsWith("data:image/")
    ) {
      throw new FrameInterpolationError(
        "INVALID_GENERATED_FRAME",
        "The interpolation model returned an invalid image.",
      );
    }
    generated.push(image);
    onProgress({
      phase: "interpolation",
      completed: index + 1,
      total: timesteps.length,
      timestep,
    });
  }

  return generated;
}

export function throwIfInterpolationCancelled(signal) {
  if (!signal?.aborted) return;
  throw new FrameInterpolationError(
    "CANCELLED",
    "Frame generation was cancelled.",
  );
}

function finiteLimit(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Number.POSITIVE_INFINITY;
}
