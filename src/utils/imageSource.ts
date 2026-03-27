const DATA_URL_PREFIX = 'data:'
const HTTP_URL_PREFIXES = ['http://', 'https://']
const NATIVE_FILE_URL_PREFIXES = ['file://', 'content://', 'ph://', 'assets-library://', 'asset://', 'asset:/']

function isLikelyWindowsPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function isLikelyRawBase64(value: string) {
  if (value.includes('://') || value.startsWith(DATA_URL_PREFIX)) {
    return false
  }

  return /^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 128
}

function hasExplicitUriScheme(value: string) {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
}

export function normalizeImageSourceUri(
  value: string | undefined,
  options?: {
    treatAsBase64?: boolean
  }
): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const compact = trimmed.replace(/\s+/g, '')

  if (compact.startsWith(DATA_URL_PREFIX)) {
    return compact
  }

  if (
    HTTP_URL_PREFIXES.some(prefix => trimmed.startsWith(prefix)) ||
    NATIVE_FILE_URL_PREFIXES.some(prefix => trimmed.startsWith(prefix))
  ) {
    return trimmed
  }

  if (options?.treatAsBase64 || isLikelyRawBase64(compact)) {
    return `data:image/png;base64,${compact}`
  }

  if (trimmed.startsWith('/') || isLikelyWindowsPath(trimmed)) {
    return `file://${trimmed}`
  }

  // Migration/mobile payloads may still carry legacy internal image references
  // such as `image://...` that React Native cannot render directly. Returning
  // null lets avatar/image callers fall back instead of showing a blank box.
  if (hasExplicitUriScheme(trimmed)) {
    return null
  }

  return trimmed
}
