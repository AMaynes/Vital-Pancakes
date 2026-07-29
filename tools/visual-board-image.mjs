/**
 * Non-destructive image crop and frame geometry. Crop bounds always stay in
 * original stored-image coordinates.
 */

export function normalizeImageCrop(crop, imageWidth, imageHeight) {
  const width = Math.max(1, Number(imageWidth) || 1);
  const height = Math.max(1, Number(imageHeight) || 1);
  if (!crop) return { x: 0, y: 0, width, height };
  const x = clamp(Number(crop.x) || 0, 0, width - 1);
  const y = clamp(Number(crop.y) || 0, 0, height - 1);
  const cropWidth = clamp(Number(crop.width) || width, 1, width - x);
  const cropHeight = clamp(Number(crop.height) || height, 1, height - y);
  return { x, y, width: cropWidth, height: cropHeight };
}

export function cropToAspect(crop, aspectRatio, imageWidth, imageHeight) {
  const normalized = normalizeImageCrop(crop, imageWidth, imageHeight);
  const aspect = Number(aspectRatio);
  if (!Number.isFinite(aspect) || aspect <= 0) return normalized;
  const centerX = normalized.x + normalized.width / 2;
  const centerY = normalized.y + normalized.height / 2;
  let width = normalized.width;
  let height = normalized.height;
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;
  let x = clamp(centerX - width / 2, 0, imageWidth - width);
  let y = clamp(centerY - height / 2, 0, imageHeight - height);
  return normalizeImageCrop({ x, y, width, height }, imageWidth, imageHeight);
}

export function fitFrameToCrop(object, crop) {
  const aspect = crop.width / crop.height;
  const currentWidth = Math.max(1, Math.abs(object.w));
  const currentHeight = Math.max(1, Math.abs(object.h));
  let width = currentWidth;
  let height = width / aspect;
  if (height > currentHeight) {
    height = currentHeight;
    width = height * aspect;
  }
  const centerX = object.x + object.w / 2;
  const centerY = object.y + object.h / 2;
  return { ...object, x: centerX - width / 2, y: centerY - height / 2, w: width, h: height };
}

export function fillCropToFrame(crop, object, imageWidth, imageHeight) {
  const frameAspect = Math.abs(object.w / object.h) || 1;
  return cropToAspect(crop, frameAspect, imageWidth, imageHeight);
}

export function resetImageCrop(imageWidth, imageHeight) {
  return normalizeImageCrop(null, imageWidth, imageHeight);
}

export function mapCropToReplacement(crop, oldWidth, oldHeight, newWidth, newHeight) {
  const normalized = normalizeImageCrop(crop, oldWidth, oldHeight);
  return normalizeImageCrop({
    x: normalized.x / oldWidth * newWidth,
    y: normalized.y / oldHeight * newHeight,
    width: normalized.width / oldWidth * newWidth,
    height: normalized.height / oldHeight * newHeight,
  }, newWidth, newHeight);
}

export function getImageDrawArguments(object, imageWidth, imageHeight) {
  const crop = normalizeImageCrop(object.crop, imageWidth, imageHeight);
  return [
    crop.x, crop.y, crop.width, crop.height,
    object.x, object.y, object.w, object.h,
  ];
}

export function getCropWorldCorners(object, crop = object.crop) {
  const source = crop ?? { x: 0, y: 0, width: object.sourceWidth || object.w, height: object.sourceHeight || object.h };
  const center = { x: object.x + object.w / 2, y: object.y + object.h / 2 };
  const corners = [
    { x: object.x, y: object.y },
    { x: object.x + object.w, y: object.y },
    { x: object.x + object.w, y: object.y + object.h },
    { x: object.x, y: object.y + object.h },
  ];
  return corners.map((point) => rotate(point, center, object.rotation ?? 0));
}

function rotate(point, center, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * cosine - y * sine, y: center.y + x * sine + y * cosine };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
