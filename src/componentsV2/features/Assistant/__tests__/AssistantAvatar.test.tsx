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

  it('normalizes raw base64 avatars into data urls', () => {
    const rawBase64 = 'a'.repeat(256)

    render(<AssistantAvatar assistant={{ avatar: rawBase64, emoji: '🤖' }} />)

    expect(screen.getByText(`image:data:image/png;base64,${rawBase64}`)).toBeTruthy()
  })

  it('strips whitespace from data url avatars restored from migration payloads', () => {
    render(<AssistantAvatar assistant={{ avatar: '  data:image/png;base64,a b c  ', emoji: '🤖' }} />)

    expect(screen.getByText('image:data:image/png;base64,abc')).toBeTruthy()
  })

  it('falls back to emoji when avatar uses an unsupported legacy scheme', () => {
    render(<AssistantAvatar assistant={{ avatar: 'image://legacy-avatar', emoji: '🤖' }} />)

    expect(screen.getByText('emoji:🤖')).toBeTruthy()
  })

  it('uses emoji rendering when avatar itself is an emoji', () => {
    render(<AssistantAvatar assistant={{ avatar: '🦊', emoji: '🤖' }} />)

    expect(screen.getByText('emoji:🦊')).toBeTruthy()
  })
})
