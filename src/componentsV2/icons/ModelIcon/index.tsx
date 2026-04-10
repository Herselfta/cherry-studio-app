import React from 'react'

import Image from '@/componentsV2/base/Image'
import { useTheme } from '@/hooks/useTheme'
import type { Model } from '@/types/assistant'
import { getModelOrProviderIcon } from '@/utils/icons'

interface ModelIconProps {
  model: Model
  size?: number
  className?: string
}

export const ModelIcon: React.FC<ModelIconProps> = ({ model, size, className }) => {
  const { isDark } = useTheme()

  const iconSource = getModelOrProviderIcon(model.id, model.provider, isDark)

  const imageSize = size || 20

  return (
    <Image 
      className={className} 
      source={iconSource} 
      style={{ width: imageSize, height: imageSize }} 
      resizeMode="contain"
    />
  )
}
