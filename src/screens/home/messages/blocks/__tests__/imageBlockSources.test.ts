import { FileTypes } from '@/types/file'
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

    expect(images).toEqual(['https://example.com/generated.png'])
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

  it('prefers url over stale file sources', () => {
    const images = resolveImageBlockUris(
      createImageBlock({
        url: 'data:image/png;base64,abc123',
        file: {
          id: 'file-1',
          name: 'desktop-image',
          origin_name: 'desktop-image.png',
          path: '/Users/mac/Desktop/desktop-image.png',
          size: 12,
          ext: '.png',
          type: FileTypes.IMAGE,
          created_at: 1,
          count: 1
        }
      })
    )

    expect(images).toEqual(['data:image/png;base64,abc123'])
  })
})
