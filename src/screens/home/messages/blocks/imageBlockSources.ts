import type { ImageMessageBlock } from '@/types/message'
import { normalizeImageSourceUri } from '@/utils/imageSource'

export { normalizeImageSourceUri }

export function resolveImageBlockUris(block: ImageMessageBlock): string[] {
  const generatedImageType = block.metadata?.generateImageResponse?.type
  const generatedSources = (block.metadata?.generateImageResponse?.images ?? [])
    .map(image => normalizeImageSourceUri(image, { treatAsBase64: generatedImageType === 'base64' }))
    .filter((image): image is string => Boolean(image))

  if (generatedSources.length > 0) {
    return [...new Set(generatedSources)]
  }

  const urlSource = normalizeImageSourceUri(block.url)
  if (urlSource) {
    return [urlSource]
  }

  const fileSource = normalizeImageSourceUri(block.file?.path)
  if (fileSource) {
    return [fileSource]
  }

  return []
}
