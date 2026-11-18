/** True when the value is an http(s) image link (preferred storage). */
export function isHttpImageUrl(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("https://") || trimmed.startsWith("http://");
}

export function isDataImageUrl(value: string) {
  return value.trim().startsWith("data:image");
}

/** Large base64 uploads previously saved in MongoDB — slow to load/save. */
export function isLegacyEmbeddedImage(value: string) {
  const trimmed = value.trim();
  return isDataImageUrl(trimmed) && trimmed.length > 50_000;
}

export function canPreviewImage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (isLegacyEmbeddedImage(trimmed)) {
    return false;
  }
  return isHttpImageUrl(trimmed) || isDataImageUrl(trimmed);
}
