import { Image as ExpoImage } from 'expo-image'
import { cn } from 'heroui-native'
import React, { forwardRef } from 'react'
import type { ImageProps as RNImageProps } from 'react-native'
import { Animated, Image as RNImage } from 'react-native'

export interface ImageProps extends RNImageProps {
  className?: string
}

const Image = forwardRef<RNImage, ImageProps>(({ className = '', style, source, ...rest }, ref) => {
  const composed = cn(className)

  return (
    <ExpoImage
      ref={ref as any}
      className={composed}
      source={source as any}
      style={style as any}
      {...(rest as any)}
    />
  )
})

Image.displayName = 'Image'

export const AnimatedImage = Animated.createAnimatedComponent(Image)

export default Image
