import React from 'react'

import Image from '@/componentsV2/base/Image'
import type { Assistant } from '@/types/assistant'
import { normalizeImageSourceUri } from '@/utils/imageSource'
import { isEmoji } from '@/utils/naming'

import EmojiAvatar from './EmojiAvatar'

interface AssistantAvatarProps {
  assistant?: Pick<Assistant, 'avatar' | 'emoji'> | null
  size?: number
  borderWidth?: number
  borderColor?: string
  borderRadius?: number
  blurIntensity?: number
}

const AssistantAvatar = ({
  assistant,
  size = 80,
  borderWidth = 4,
  borderColor = '$backgroundPrimary',
  borderRadius,
  blurIntensity = 80
}: AssistantAvatarProps) => {
  const avatar = assistant?.avatar?.trim()
  const normalizedAvatar = normalizeImageSourceUri(avatar)

  if (!avatar || isEmoji(avatar)) {
    return (
      <EmojiAvatar
        emoji={avatar || assistant?.emoji || '⭐️'}
        size={size}
        borderWidth={borderWidth}
        borderColor={borderColor}
        borderRadius={borderRadius}
        blurIntensity={blurIntensity}
      />
    )
  }

  if (!normalizedAvatar) {
    return (
      <EmojiAvatar
        emoji={assistant?.emoji || '⭐️'}
        size={size}
        borderWidth={borderWidth}
        borderColor={borderColor}
        borderRadius={borderRadius}
        blurIntensity={blurIntensity}
      />
    )
  }

  return (
    <Image
      source={{ uri: normalizedAvatar }}
      resizeMode="cover"
      className="overflow-hidden"
      style={{
        width: size,
        height: size,
        borderWidth,
        borderColor,
        borderRadius: borderRadius || size / 2
      }}
    />
  )
}

export default AssistantAvatar
