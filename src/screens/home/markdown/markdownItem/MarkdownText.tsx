import React from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { withUniwind } from 'uniwind'

export const StyledUITextView = withUniwind(Text)

interface MarkdownTextProps {
  content: string
  className?: string
  style?: StyleProp<TextStyle>
}

export function MarkdownText({ content, className, style }: MarkdownTextProps) {
  return (
    <StyledUITextView className={className} style={style}>
      {content}
    </StyledUITextView>
  )
}
