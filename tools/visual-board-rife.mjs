import {
  FrameInterpolationError,
  assertFrameFitsWebGpu,
  assertWebGpuSupported,
  generateIntermediateFrameImages,
  throwIfInterpolationCancelled,
} from "./visual-board-interpolation.mjs?v=1";

const ONNX_RUNTIME_VERSION = "1.27.0";
const ONNX_RUNTIME_DIST_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
const ONNX_RUNTIME_MODULE_URL = `${ONNX_RUNTIME_DIST_URL}ort.webgpu.bundle.min.mjs`;

// MIT-licensed timestep model documented at:
// https://huggingface.co/walterlow/RIFE_fp32_timestep
const RIFE_MODEL_REVISION = "ee09066f9822f8b28b8477a1b4cc30f19d607590";
const RIFE_MODEL_URL = `https://huggingface.co/walterlow/RIFE_fp32_timestep/resolve/${RIFE_MODEL_REVISION}/RIFE_fp32_timestep.onnx`;
const RIFE_MODEL_CACHE = "vital-pancakes-rife-v1";
const MAX_INFERENCE_DIMENSION = 1024;

let ortModulePromise = null;
let modelBytes = null;
let activeSession = null;

export async function interpolateRifeFrames({
  startFrame,
  endFrame,
  count,
  signal,
  onProgress = () => {},
}) {
  try {
    onProgress({
      phase: "webgpu-check",
      message: "Checking WebGPU support",
    });
    const adapter = await assertWebGpuSupported();
    throwIfInterpolationCancelled(signal);

    onProgress({
      phase: "preparing-images",
      message: "Preparing source frames",
    });
    const prepared = await prepareFramePair(
      startFrame.dataUrl,
      endFrame.dataUrl,
      signal,
    );
    assertFrameFitsWebGpu(
      prepared.inferenceWidth,
      prepared.inferenceHeight,
      adapter.limits,
    );

    const bytes = await loadRifeModelBytes({ signal, onProgress });
    const ort = await loadOnnxRuntime({ signal, onProgress });
    const session = await getRifeSession({
      ort,
      bytes,
      width: prepared.inferenceWidth,
      height: prepared.inferenceHeight,
      signal,
      onProgress,
    });

    const inputTensor = new ort.Tensor(
      "float32",
      prepared.inputData,
      [1, 6, prepared.inferenceHeight, prepared.inferenceWidth],
    );
    try {
      return await generateIntermediateFrameImages({
        count,
        signal,
        onProgress,
        interpolateAt: async (timestep, { index, total }) => {
          throwIfInterpolationCancelled(signal);
          const timestepTensor = new ort.Tensor(
            "float32",
            new Float32Array([timestep]),
            [],
          );
          let outputTensor;
          try {
            const outputs = await session.run({
              input: inputTensor,
              timestep: timestepTensor,
            });
            outputTensor = outputs.output ?? outputs[session.outputNames[0]];
            throwIfInterpolationCancelled(signal);
            return {
              name: `RIFE in-between ${index + 1} of ${total}`,
              dataUrl: tensorToImageDataUrl(
                outputTensor.data,
                prepared.inferenceWidth,
                prepared.inferenceHeight,
                prepared.outputWidth,
                prepared.outputHeight,
              ),
            };
          } finally {
            timestepTensor.dispose?.();
            outputTensor?.dispose?.();
          }
        },
      });
    } finally {
      inputTensor.dispose?.();
    }
  } catch (error) {
    if (error instanceof FrameInterpolationError) throw error;
    throwIfInterpolationCancelled(signal);
    throw mapRifeError(error);
  }
}

async function loadRifeModelBytes({ signal, onProgress }) {
  if (modelBytes) {
    onProgress({
      phase: "model-ready",
      message: "RIFE model ready",
      loaded: modelBytes.byteLength,
      total: modelBytes.byteLength,
    });
    return modelBytes;
  }

  if (!globalThis.caches?.open) {
    throw new FrameInterpolationError(
      "MODEL_CACHE",
      "Browser model storage is unavailable. Allow site storage and try again.",
    );
  }

  let cache;
  try {
    cache = await caches.open(RIFE_MODEL_CACHE);
  } catch (error) {
    throw new FrameInterpolationError(
      "MODEL_CACHE",
      "The RIFE model cache could not be opened. Allow site storage and try again.",
      { cause: error },
    );
  }

  const cachedResponse = await cache.match(RIFE_MODEL_URL);
  if (cachedResponse) {
    onProgress({
      phase: "model-cache",
      message: "Loading cached RIFE model",
    });
    modelBytes = await cachedResponse.arrayBuffer();
    throwIfInterpolationCancelled(signal);
    onProgress({
      phase: "model-ready",
      message: "Cached RIFE model ready",
      loaded: modelBytes.byteLength,
      total: modelBytes.byteLength,
    });
    return modelBytes;
  }

  onProgress({
    phase: "model-download",
    message: "Downloading RIFE model",
    loaded: 0,
    total: 0,
  });

  let response;
  try {
    response = await fetch(RIFE_MODEL_URL, {
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throwIfInterpolationCancelled(signal);
    throw new FrameInterpolationError(
      "MODEL_DOWNLOAD",
      "The RIFE model could not be downloaded. Check your connection and try again.",
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new FrameInterpolationError(
      "MODEL_DOWNLOAD",
      `The RIFE model download failed with status ${response.status}.`,
    );
  }

  modelBytes = await readResponseBytes(response, signal, onProgress);
  try {
    await cache.put(
      RIFE_MODEL_URL,
      new Response(modelBytes, {
        headers: {
          "Content-Length": String(modelBytes.byteLength),
          "Content-Type": "application/octet-stream",
        },
      }),
    );
  } catch (error) {
    modelBytes = null;
    throw new FrameInterpolationError(
      "MODEL_CACHE",
      "The downloaded RIFE model could not be cached. Free browser storage and try again.",
      { cause: error },
    );
  }
  throwIfInterpolationCancelled(signal);

  onProgress({
    phase: "model-ready",
    message: "RIFE model downloaded and cached",
    loaded: modelBytes.byteLength,
    total: modelBytes.byteLength,
  });
  return modelBytes;
}

async function readResponseBytes(response, signal, onProgress) {
  const total = Number(response.headers.get("Content-Length")) || 0;
  if (!response.body?.getReader) {
    const bytes = await response.arrayBuffer();
    throwIfInterpolationCancelled(signal);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    throwIfInterpolationCancelled(signal);
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({
      phase: "model-download",
      message: "Downloading RIFE model",
      loaded,
      total,
    });
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

async function loadOnnxRuntime({ signal, onProgress }) {
  onProgress({
    phase: "runtime-load",
    message: "Loading WebGPU runtime",
  });
  ortModulePromise ??= import(ONNX_RUNTIME_MODULE_URL);
  let ort;
  try {
    ort = await ortModulePromise;
  } catch (error) {
    ortModulePromise = null;
    throw new FrameInterpolationError(
      "RUNTIME_LOAD",
      "The WebGPU runtime could not be loaded. Check your connection and try again.",
      { cause: error },
    );
  }
  throwIfInterpolationCancelled(signal);
  ort.env.wasm.wasmPaths = ONNX_RUNTIME_DIST_URL;
  ort.env.wasm.numThreads = 1;
  return ort;
}

async function getRifeSession({
  ort,
  bytes,
  width,
  height,
  signal,
  onProgress,
}) {
  const key = `${width}x${height}`;
  if (activeSession?.key === key) return activeSession.session;

  onProgress({
    phase: "session-load",
    message: "Preparing RIFE on WebGPU",
  });
  if (activeSession) {
    await activeSession.session.release();
    activeSession = null;
  }

  let session;
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
      freeDimensionOverrides: {
        dynamic_dim_0: 1,
        dynamic_dim_1: 6,
        dynamic_dim_2: height,
        dynamic_dim_3: width,
      },
    });
  } catch (error) {
    throw mapRifeError(error);
  }
  if (signal?.aborted) {
    await session.release();
    throwIfInterpolationCancelled(signal);
  }
  activeSession = { key, session };
  return session;
}

async function prepareFramePair(startDataUrl, endDataUrl, signal) {
  const [startImage, endImage] = await Promise.all([
    loadImage(startDataUrl),
    loadImage(endDataUrl),
  ]);
  throwIfInterpolationCancelled(signal);

  const outputWidth = Math.max(startImage.naturalWidth, endImage.naturalWidth);
  const outputHeight = Math.max(startImage.naturalHeight, endImage.naturalHeight);
  const scale = Math.min(
    1,
    MAX_INFERENCE_DIMENSION / Math.max(outputWidth, outputHeight),
  );
  const inferenceWidth = Math.max(2, Math.round(outputWidth * scale));
  const inferenceHeight = Math.max(2, Math.round(outputHeight * scale));
  const startPixels = readImagePixels(startImage, inferenceWidth, inferenceHeight);
  const endPixels = readImagePixels(endImage, inferenceWidth, inferenceHeight);
  const pixelCount = inferenceWidth * inferenceHeight;
  const inputData = new Float32Array(pixelCount * 6);

  writePlanarRgb(inputData, 0, startPixels, pixelCount);
  writePlanarRgb(inputData, pixelCount * 3, endPixels, pixelCount);
  return {
    inferenceWidth,
    inferenceHeight,
    outputWidth,
    outputHeight,
    inputData,
  };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => {
      reject(new FrameInterpolationError(
        "SOURCE_IMAGE",
        "One of the source frames could not be read.",
      ));
    }, { once: true });
    image.src = dataUrl;
  });
}

function readImagePixels(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return context.getImageData(0, 0, width, height).data;
}

function writePlanarRgb(target, offset, pixels, pixelCount) {
  for (let index = 0; index < pixelCount; index += 1) {
    const pixelOffset = index * 4;
    target[offset + index] = pixels[pixelOffset] / 255;
    target[offset + pixelCount + index] = pixels[pixelOffset + 1] / 255;
    target[offset + pixelCount * 2 + index] = pixels[pixelOffset + 2] / 255;
  }
}

function tensorToImageDataUrl(
  tensorData,
  inferenceWidth,
  inferenceHeight,
  outputWidth,
  outputHeight,
) {
  const pixelCount = inferenceWidth * inferenceHeight;
  const pixels = new Uint8ClampedArray(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const pixelOffset = index * 4;
    pixels[pixelOffset] = toByte(tensorData[index]);
    pixels[pixelOffset + 1] = toByte(tensorData[pixelCount + index]);
    pixels[pixelOffset + 2] = toByte(tensorData[pixelCount * 2 + index]);
    pixels[pixelOffset + 3] = 255;
  }

  const inferenceCanvas = document.createElement("canvas");
  inferenceCanvas.width = inferenceWidth;
  inferenceCanvas.height = inferenceHeight;
  inferenceCanvas.getContext("2d").putImageData(
    new ImageData(pixels, inferenceWidth, inferenceHeight),
    0,
    0,
  );
  if (inferenceWidth === outputWidth && inferenceHeight === outputHeight) {
    return inferenceCanvas.toDataURL("image/webp", 0.92);
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  outputCanvas.getContext("2d").drawImage(
    inferenceCanvas,
    0,
    0,
    outputWidth,
    outputHeight,
  );
  return outputCanvas.toDataURL("image/webp", 0.92);
}

function toByte(value) {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function mapRifeError(error) {
  const detail = String(error?.message ?? error);
  if (/out of memory|memory allocation|buffer.*(?:large|size)|device lost/i.test(detail)) {
    return new FrameInterpolationError(
      "GPU_MEMORY",
      "The GPU ran out of memory. Resize the source images smaller, close GPU-heavy tabs, and try again.",
      { cause: error },
    );
  }
  return new FrameInterpolationError(
    "RIFE_INFERENCE",
    "RIFE could not generate the intermediate frames on this GPU.",
    { cause: error },
  );
}
