import { type ImageMessageBlock, MessageBlockStatus, MessageBlockType } from '@/types/message'

import { normalizeImageSourceUri, resolveImageBlockUris } from '../imageBlockSources'

function createImageBlock(overrides: Partial<ImageMessageBlock> = {}): ImageMessageBlock {
  return {
    id: 'block-1',
    messageId: 'message-1',
    type: MessageBlockType.IMAGE,
    createdAt: Date.now(),
    status: MessageBlockStatus.SUCCESS,
    ...overrides
  }
}

describe('imageBlockSources', () => {
  it('uses generated image response images before other sources', () => {
    const images = resolveImageBlockUris(
      createImageBlock({
        url: 'https://example.com/fallback.png',
        metadata: {
          generateImageResponse: {
            type: 'url',
            images: ['https://example.com/generated.png']
          }
        }
      })
    )

    expect(images).toEqual(['https://example.com/generated.png', 'https://example.com/fallback.png'])
  })

  it('normalizes raw base64 generated images into data urls', () => {
    const images = resolveImageBlockUris(
      createImageBlock({
        metadata: {
          generateImageResponse: {
            type: 'base64',
            images: ['a'.repeat(256)]
          }
        }
      })
    )

    expect(images).toEqual([`data:image/png;base64,${'a'.repeat(256)}`])
  })

  it('prefixes absolute desktop paths with file://', () => {
    expect(normalizeImageSourceUri('/Users/mac/image.png')).toBe('file:///Users/mac/image.png')
    expect(normalizeImageSourceUri('C:\\Users\\mac\\image.png')).toBe('file://C:\\Users\\mac\\image.png')
  })

  it('deduplicates repeated sources', () => {
    const images = resolveImageBlockUris(
      createImageBlock({
        url: 'https://example.com/shared.png',
        metadata: {
          generateImageResponse: {
            type: 'url',
            images: ['https://example.com/shared.png']
          }
        }
      })
    )

    expect(images).toEqual(['https://example.com/shared.png'])
  })
})
