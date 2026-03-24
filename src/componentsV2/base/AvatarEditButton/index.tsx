import { LinearGradient } from 'expo-linear-gradient'
import React from 'react'
import { Pressable, View } from 'react-native'
import type { EmojiType } from 'rn-emoji-keyboard'
import EmojiPicker from 'rn-emoji-keyboard'

import Image from '@/componentsV2/base/Image'
import YStack from '@/componentsV2/layout/YStack'
import { useTheme } from '@/hooks/useTheme'
import { isEmoji } from '@/utils/naming'

import Text from '../Text'

interface AvatarEditButtonProps {
  /** 头像内容 - 可以是 emoji 字符串或 React 节点（如图标） */
  content: string | React.ReactNode
  /** 编辑按钮图标 */
  editIcon: React.ReactNode
  /** 头像大小，默认 120 */
  size?: number
  /** 编辑按钮大小，默认 40 */
  editButtonSize?: number
  /** 编辑按钮点击事件 */
  onEditPress?: () => void
  updateAvatar: (avatar: string) => Promise<void>
}

export function AvatarEditButton({
  content,
  editIcon,
  size = 120,
  editButtonSize = 40,
  onEditPress,
  updateAvatar
}: AvatarEditButtonProps) {
  const { isDark } = useTheme()
  const [isOpen, setIsOpen] = React.useState<boolean>(false)
  const isEmojiContent = typeof content === 'string' && isEmoji(content)
  const isImageContent = typeof content === 'string' && !isEmojiContent

  const handlePick = async (emoji: EmojiType) => {
    setIsOpen(prev => !prev)
    await updateAvatar(emoji.emoji)
  }

  return (
    <YStack className="relative">
      <Pressable
        onPress={() => setIsOpen(prev => !prev)}
        className="primary-border overflow-hidden rounded-full border-[5px]"
        style={({ pressed }) => ({
          width: size,
          height: size,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: pressed ? 0.8 : 1
        })}>
        {isEmojiContent ? (
          <Text style={{ fontSize: size * 0.5, lineHeight: size * 0.65 }} className="text-foreground">
            {content}
          </Text>
        ) : isImageContent ? (
          <Image source={{ uri: content }} resizeMode="cover" className="h-full w-full" />
        ) : (
          <View
            pointerEvents="none"
            style={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
            {content}
          </View>
        )}
      </Pressable>

      <YStack
        className="primary-background absolute bottom-0 right-0 z-10 rounded-full"
        style={{
          width: editButtonSize,
          height: editButtonSize
        }}>
        <LinearGradient
          colors={['#81df94', '#00B96B']}
          start={[1, 1]}
          end={[0, 0]}
          style={{
            width: editButtonSize,
            height: editButtonSize,
            borderRadius: editButtonSize / 2,
            justifyContent: 'center',
            alignItems: 'center'
          }}>
          <Pressable
            onPress={() => onEditPress?.()}
            disabled={!onEditPress}
            style={({ pressed }) => ({
              width: editButtonSize,
              height: editButtonSize,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1
            })}>
            {editIcon}
          </Pressable>
        </LinearGradient>
      </YStack>
      <EmojiPicker
        onEmojiSelected={handlePick}
        open={isOpen}
        onClose={() => setIsOpen(false)}
        categoryPosition="top"
        theme={{
          container: isDark ? '#19191cff' : '#ffffffff',
          header: isDark ? '#f9f9f9ff' : '#202020ff',
          category: {
            icon: '#00b96bff',
            iconActive: '#fff',
            container: isDark ? '#19191cff' : '#ffffffff',
            containerActive: '#00b96bff'
          }
        }}
      />
    </YStack>
  )
}
