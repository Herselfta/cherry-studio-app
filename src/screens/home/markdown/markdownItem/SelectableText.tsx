import type { ReactNode } from 'react'
import React from 'react'
import { Platform, Text, type TextProps } from 'react-native'
import { withUniwind } from 'uniwind'

const StyledUITextView = withUniwind(Text)

interface SelectableTextProps extends TextProps {
  children: ReactNode
}

export function SelectableText({ children, ...props }: SelectableTextProps) {
  return (
    <StyledUITextView selectable selectionColor={Platform.OS === 'android' ? '#99e2c5' : undefined} {...props}>
      {children}
    </StyledUITextView>
  )
}
