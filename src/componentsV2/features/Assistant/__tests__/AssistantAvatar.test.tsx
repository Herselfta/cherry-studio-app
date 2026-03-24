import { render, screen } from '@testing-library/react-native'
import React from 'react'

import AssistantAvatar from '../AssistantAvatar'

jest.mock('@/componentsV2/base/Image', () => {
  const React = require('react')
  const { Text } = require('react-native')

  return {
    __esModule: true,
    default: ({ source }: any) => React.createElement(Text, null, `image:${source?.uri ?? ''}`)
  }
})

jest.mock('../EmojiAvatar', () => {
  const React = require('react')
  const { Text } = require('react-native')

  return {
    __esModule: true,
    default: ({ emoji }: any) => React.createElement(Text, null, `emoji:${emoji ?? ''}`)
  }
})

describe('AssistantAvatar', () => {
  it('renders image avatars when avatar is a non-emoji string', () => {
    render(<AssistantAvatar assistant={{ avatar: 'data:image/png;base64,abc', emoji: '🤖' }} />)

    expect(screen.getByText('image:data:image/png;base64,abc')).toBeTruthy()
  })

  it('uses emoji rendering when avatar itself is an emoji', () => {
    render(<AssistantAvatar assistant={{ avatar: '🦊', emoji: '🤖' }} />)

    expect(screen.getByText('emoji:🦊')).toBeTruthy()
  })
})
