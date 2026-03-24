import React, { memo, useState } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'

import { Image, ImageGalleryViewer, ImageItem, ImageSkeleton } from '@/componentsV2'
import { ImageOff } from '@/componentsV2/icons/LucideIcon'
import type { ImageMessageBlock } from '@/types/message'
import { MessageBlockStatus } from '@/types/message'

import { resolveImageBlockUris } from './imageBlockSources'

interface Props {
  block: ImageMessageBlock
}

const ImageBlock: React.FC<Props> = ({ block }) => {
  const [visible, setVisible] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [failedUris, setFailedUris] = useState<Record<string, true>>({})
  const { width: screenWidth } = useWindowDimensions()
  const imageUris = resolveImageBlockUris(block)
  const imageSize = imageUris.length > 1 ? Math.min((screenWidth - 40) / 2, 180) : Math.min(screenWidth * 0.62, 260)

  if (block.status === MessageBlockStatus.PENDING) return <ImageSkeleton />

  if (imageUris.length === 0) {
    return null
  }

  const hasOnlyFileSource =
    imageUris.length === 1 && block.file?.path && !block.url && !block.metadata?.generateImageResponse?.images?.length

  if (hasOnlyFileSource && block.file) {
    return <ImageItem file={block.file} />
  }

  return (
    <>
      <View className="flex-row flex-wrap gap-2">
        {imageUris.map((uri, index) => {
          const hasError = failedUris[uri] === true
          return (
            <Pressable
              key={`${block.id}-${index}`}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1
              })}
              disabled={hasError}
              onPress={() => {
                setSelectedIndex(index)
                setVisible(true)
              }}>
              {hasError ? (
                <View
                  className="bg-gray-5 items-center justify-center rounded-2xl"
                  style={{ width: imageSize, height: imageSize }}>
                  <ImageOff size={imageSize * 0.3} className="text-zinc-400/20" />
                </View>
              ) : (
                <Image
                  source={{ uri }}
                  className="rounded-2xl"
                  resizeMode="cover"
                  style={{ width: imageSize, height: imageSize }}
                  onError={() => {
                    // Desktop migration payloads can contain generated images in
                    // metadata/url form. Keep those renderable on mobile, but if
                    // a source still fails (for example a desktop-only local file
                    // path), degrade to a visible placeholder instead of hiding
                    // the block entirely.
                    setFailedUris(current => ({ ...current, [uri]: true }))
                  }}
                />
              )}
            </Pressable>
          )
        })}
      </View>
      <ImageGalleryViewer
        images={imageUris}
        initialIndex={selectedIndex}
        visible={visible}
        onClose={() => setVisible(false)}
      />
    </>
  )
}

export default memo(ImageBlock)
