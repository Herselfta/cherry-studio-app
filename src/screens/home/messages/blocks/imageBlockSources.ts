import type { ImageMessageBlock } from '@/types/message'
import { normalizeImageSourceUri } from '@/utils/imageSource'

export { normalizeImageSourceUri }

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
