const EXPORT_FORMATS = Object.freeze({
  mp4: Object.freeze({
    codecs: Object.freeze(["avc"]),
    mimeType: "video/mp4",
  }),
  webm: Object.freeze({
    codecs: Object.freeze(["vp9", "vp8", "av1"]),
    mimeType: "video/webm",
  }),
});

const MAX_EXPORT_DIMENSION = 1920;

export class AnimationExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AnimationExportError";
    this.code = code;
  }
}

export function selectAnimationExportFormat(format) {
  const normalizedFormat = String(format).toLowerCase();
  const config = EXPORT_FORMATS[normalizedFormat];
  if (!config) {
    throw new AnimationExportError(
      "UNSUPPORTED_FORMAT",
      "Choose MP4 or WebM.",
    );
  }
  return {
    codecs: config.codecs,
    extension: normalizedFormat,
    format: normalizedFormat,
    mimeType: config.mimeType,
  };
}

export function createAnimationFrameSchedule(frames, frameDurationMs) {
  const duration = Number(frameDurationMs);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AnimationExportError(
      "INVALID_DURATION",
      "Frame time must be greater than zero.",
    );
  }

  return frames
    .filter((frame) => (
      typeof frame?.dataUrl === "string"
      && frame.dataUrl.startsWith("data:image/")
    ))
    .map((frame, index) => ({
      dataUrl: frame.dataUrl,
      id: frame.id,
      index,
      name: frame.name,
      startsAtMs: index * duration,
    }));
}

export function createAnimationExportFilename(extension, date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replaceAll(":", "-");
  return `vital-pancakes-animation-${stamp}.${extension}`;
}

export async function recordAnimationVideo({
  frames,
  frameDurationMs,
  format,
  onProgress = () => {},
  signal,
  documentRef = globalThis.document,
  ImageClass = globalThis.Image,
  loadEncoder = () => import("../vendor/mediabunny-1.51.0.min.mjs"),
}) {
  throwIfCancelled(signal);
  const schedule = createAnimationFrameSchedule(frames, frameDurationMs);
  if (schedule.length < 2) {
    throw new AnimationExportError(
      "NOT_ENOUGH_FRAMES",
      "Add at least two image frames before saving an animation.",
    );
  }

  const selectedFormat = selectAnimationExportFormat(format);
  if (!documentRef?.createElement || typeof ImageClass !== "function") {
    throw new AnimationExportError(
      "RECORDER_UNAVAILABLE",
      "Video export is not available in this browser.",
    );
  }

  const decodedFrames = [];
  for (const [index, frame] of schedule.entries()) {
    throwIfCancelled(signal);
    decodedFrames.push(await decodeFrame(frame.dataUrl, ImageClass, signal));
    onProgress({
      phase: "loading",
      completed: index + 1,
      total: schedule.length,
    });
  }

  const dimensions = getExportDimensions(decodedFrames);
  const canvas = documentRef.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new AnimationExportError(
      "RECORDER_UNAVAILABLE",
      "Canvas video export is not available in this browser.",
    );
  }

  let encoder;
  try {
    encoder = await loadEncoder();
  } catch {
    throw new AnimationExportError(
      "ENCODER_LOAD_FAILED",
      "The video tools could not be loaded. Check your connection and try again.",
    );
  }
  throwIfCancelled(signal);

  const bitrate = getVideoBitRate(canvas.width, canvas.height);
  const codec = await encoder.getFirstEncodableVideoCodec(
    selectedFormat.codecs,
    {
      width: canvas.width,
      height: canvas.height,
      bitrate,
    },
  );
  if (!codec) {
    throw new AnimationExportError(
      "FORMAT_UNAVAILABLE",
      `${selectedFormat.format.toUpperCase()} export is not supported by this device. Try the other format.`,
    );
  }

  const target = new encoder.BufferTarget();
  const outputFormat = selectedFormat.format === "mp4"
    ? new encoder.Mp4OutputFormat({ fastStart: "in-memory" })
    : new encoder.WebMOutputFormat();
  const output = new encoder.Output({
    format: outputFormat,
    target,
  });
  const videoSource = new encoder.CanvasSource(canvas, {
    codec,
    bitrate,
  });
  const framesPerSecond = Math.min(60, 1000 / Number(frameDurationMs));
  output.addVideoTrack(videoSource, { frameRate: framesPerSecond });

  const cancelOutput = () => {
    if (["pending", "started"].includes(output.state)) {
      output.cancel().catch(() => {});
    }
  };
  signal?.addEventListener("abort", cancelOutput, { once: true });

  try {
    await output.start();
    const frameDurationSeconds = Number(frameDurationMs) / 1000;
    for (const [index, image] of decodedFrames.entries()) {
      throwIfCancelled(signal);
      drawContainedFrame(context, canvas, image);
      await videoSource.add(
        index * frameDurationSeconds,
        frameDurationSeconds,
        { keyFrame: index === 0 },
      );
      onProgress({
        phase: "encoding",
        completed: index + 1,
        total: decodedFrames.length,
      });
    }
    videoSource.close();
    await output.finalize();
    throwIfCancelled(signal);
  } catch (error) {
    if (["pending", "started"].includes(output.state)) {
      await output.cancel().catch(() => {});
    }
    if (signal?.aborted) throw cancellationError();
    if (error instanceof AnimationExportError) throw error;
    throw new AnimationExportError(
      "ENCODING_FAILED",
      error?.message || "The browser could not encode this animation.",
    );
  } finally {
    signal?.removeEventListener("abort", cancelOutput);
  }

  const buffer = target.buffer;
  const blob = new Blob(buffer ? [buffer] : [], { type: selectedFormat.mimeType });
  if (!blob.size) {
    throw new AnimationExportError(
      "EMPTY_EXPORT",
      "The browser produced an empty video. Try WebM or reduce the frame size.",
    );
  }
  return {
    blob,
    extension: selectedFormat.extension,
    height: canvas.height,
    mimeType: selectedFormat.mimeType,
    width: canvas.width,
  };
}

function decodeFrame(dataUrl, ImageClass, signal) {
  return new Promise((resolve, reject) => {
    const image = new ImageClass();
    const cancel = () => {
      cleanup();
      image.src = "";
      reject(cancellationError());
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", cancel);
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new AnimationExportError(
        "FRAME_DECODE_FAILED",
        "One of the animation frames could not be read.",
      ));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    image.decoding = "async";
    image.src = dataUrl;
  });
}

function getExportDimensions(images) {
  const sourceWidth = Math.max(...images.map((image) => image.naturalWidth || image.width || 1));
  const sourceHeight = Math.max(...images.map((image) => image.naturalHeight || image.height || 1));
  const scale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(sourceWidth, sourceHeight));
  return {
    width: makeEvenDimension(sourceWidth * scale),
    height: makeEvenDimension(sourceHeight * scale),
  };
}

function makeEvenDimension(value) {
  return Math.max(16, Math.round(value / 2) * 2);
}

function getVideoBitRate(width, height) {
  return Math.min(12_000_000, Math.max(2_500_000, width * height * 4));
}

function drawContainedFrame(context, canvas, image) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const scale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
  context.restore();
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError();
}

function cancellationError() {
  return new AnimationExportError("CANCELLED", "Animation export cancelled.");
}
