export const DEFAULT_FRAME_DURATION_MS = 100;
export const MIN_FRAME_DURATION_MS = 25;
export const MAX_FRAME_DURATION_MS = 5000;
export const MAX_ANIMATION_FRAMES = 120;

export function normalizeAnimation(rawAnimation) {
  const rawFrames = Array.isArray(rawAnimation?.frames) ? rawAnimation.frames : [];
  return {
    frameDurationMs: normalizeFrameDuration(rawAnimation?.frameDurationMs),
    frames: rawFrames
      .map(normalizeFrame)
      .filter(Boolean)
      .slice(0, MAX_ANIMATION_FRAMES),
  };
}

export function normalizeFrameDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return DEFAULT_FRAME_DURATION_MS;
  return Math.min(
    MAX_FRAME_DURATION_MS,
    Math.max(MIN_FRAME_DURATION_MS, Math.round(duration)),
  );
}

export function createAnimationFrame(id, index, image = null) {
  return {
    id,
    name: image?.name || `Frame ${index + 1}`,
    dataUrl: isImageDataUrl(image?.dataUrl) ? image.dataUrl : "",
  };
}

export function replaceAnimationFrame(frames, frameId, image) {
  if (!isImageDataUrl(image?.dataUrl)) return frames;
  return frames.map((frame) => (
    frame.id === frameId
      ? { ...frame, name: image.name || frame.name, dataUrl: image.dataUrl }
      : frame
  ));
}

export function getPlayableFrames(frames) {
  return frames.filter((frame) => isImageDataUrl(frame.dataUrl));
}

function normalizeFrame(rawFrame) {
  if (!rawFrame || typeof rawFrame !== "object") return null;
  const id = typeof rawFrame.id === "string" && rawFrame.id ? rawFrame.id : null;
  if (!id) return null;
  return {
    id,
    name: typeof rawFrame.name === "string" && rawFrame.name.trim()
      ? rawFrame.name.trim().slice(0, 120)
      : "Frame",
    dataUrl: isImageDataUrl(rawFrame.dataUrl) ? rawFrame.dataUrl : "",
  };
}

function isImageDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}
