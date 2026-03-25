import * as Clipboard from 'expo-clipboard'
import { isEmpty } from 'lodash'
import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, View } from 'react-native'

import type { MainTextMessageBlock } from '@/types/message'
import { useToast } from '@/hooks/useToast'
import { escapeBrackets, removeSvgEmptyLines } from '@/utils/formats'

import { MarkdownRenderer } from '../../markdown/MarkdownRenderer'

interface Props {
  block: MainTextMessageBlock
  citationBlockId?: string
}
// TOFIX：会有一个奇怪的空组件渲染，导致两个block之间的gap有问题（由于会产生一个莫名其妙的组件）
// 在连续调用mcp时会出现
const MainTextBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  const toast = useToast()

  const getContent = useCallback(() => {
    const empty = isEmpty(block.content)
    const paused = block.status === 'paused'
    const content = empty && paused ? t('message.chat.completion.paused') : block.content
    return removeSvgEmptyLines(escapeBrackets(content))
  }, [block.content, block.status, t])

  const content = getContent()

  const handleLongPressCopy = useCallback(async () => {
    if (Platform.OS !== 'android' || !content.trim()) return

    try {
      await Clipboard.setStringAsync(content)
      toast.show(t('common.copied'))
    } catch {
      toast.show(t('common.error_occurred'), { color: 'red', duration: 2500 })
    }
  }, [content, t, toast])

  if (Platform.OS === 'android') {
    return (
      <Pressable delayLongPress={250} onLongPress={handleLongPressCopy}>
        <View>
          <MarkdownRenderer content={content} />
        </View>
      </Pressable>
    )
  }

  return (
    <View>
      <MarkdownRenderer content={content} />
    </View>
  )
}

export default memo(MainTextBlock)
