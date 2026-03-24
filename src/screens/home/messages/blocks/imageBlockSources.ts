import type { ImageMessageBlock } from '@/types/message'

const DATA_URL_PREFIX = 'data:'
const HTTP_URL_PREFIXES = ['http://', 'https://']
const NATIVE_FILE_URL_PREFIXES = ['file://', 'content://', 'ph://', 'assets-library://']

function isLikelyWindowsPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function isLikelyRawBase64(value: string) {
  if (value.includes('://') || value.startsWith(DATA_URL_PREFIX)) {
    return false
  }

  return /^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 128
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

  if (
    trimmed.startsWith(DATA_URL_PREFIX) ||
    HTTP_URL_PREFIXES.some(prefix => trimmed.startsWith(prefix)) ||
    NATIVE_FILE_URL_PREFIXES.some(prefix => trimmed.startsWith(prefix))
  ) {
    return trimmed
  }

  if (options?.treatAsBase64 || isLikelyRawBase64(trimmed)) {
    return `data:image/png;base64,${trimmed}`
  }

  if (trimmed.startsWith('/') || isLikelyWindowsPath(trimmed)) {
    return `file://${trimmed}`
  }

  return trimmed
}

export function resolveImageBlockUris(block: ImageMessageBlock): string[] {
  const sources: string[] = []
  const generatedImageType = block.metadata?.generateImageResponse?.type

  for (const image of block.metadata?.generateImageResponse?.images ?? []) {
    const normalized = normalizeImageSourceUri(image, { treatAsBase64: generatedImageType === 'base64' })
    if (normalized) {
      sources.push(normalized)
    }
  }

  const urlSource = normalizeImageSourceUri(block.url)
  if (urlSource) {
    sources.push(urlSource)
  }

  const fileSource = normalizeImageSourceUri(block.file?.path)
  if (fileSource) {
    sources.push(fileSource)
  }

  return [...new Set(sources)]
}
