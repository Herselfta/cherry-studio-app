import { fireEvent, render, screen } from '@testing-library/react-native'
import React from 'react'

import { TopicList } from '../index'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

jest.mock('@/componentsV2/base/Text', () => {
  const React = require('react')
  const { Text } = require('react-native')

  return {
    __esModule: true,
    default: ({ children, ...props }: any) => React.createElement(Text, props, children)
  }
})

jest.mock('@/componentsV2/layout/XStack', () => {
  const React = require('react')
  const { View } = require('react-native')

  return {
    __esModule: true,
    default: ({ children, ...props }: any) => React.createElement(View, props, children)
  }
})

jest.mock('@/componentsV2/layout/YStack', () => {
  const React = require('react')
  const { View } = require('react-native')

  return {
    __esModule: true,
    default: ({ children, ...props }: any) => React.createElement(View, props, children)
  }
})

jest.mock('@/componentsV2/icons', () => ({
  ChevronDown: () => null,
  ChevronRight: () => null
}))

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem }: any) => {
    const React = require('react')
    const { View } = require('react-native')

    return React.createElement(
      View,
      null,
      data.map((item: any, index: number) =>
        React.createElement(
          View,
          { key: item.type === 'header' ? `header-${item.groupKey}` : item.topic.id },
          renderItem({ item, index })
        )
      )
    )
  }
}))

jest.mock('@/componentsV2/base/Dialog/useDialogManager', () => ({
  presentDialog: jest.fn()
}))

jest.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    show: jest.fn()
  })
}))

jest.mock('@/hooks/useTopic', () => ({
  useCurrentTopic: () => ({
    currentTopicId: '',
    switchTopic: jest.fn()
  })
}))

jest.mock('@/services/AssistantService', () => ({
  getDefaultAssistant: jest.fn()
}))

jest.mock('@/services/MessagesService', () => ({
  deleteMessagesByTopicId: jest.fn()
}))

jest.mock('@/services/TopicService', () => ({
  topicService: {
    deleteTopic: jest.fn(),
    renameTopic: jest.fn(),
    createTopic: jest.fn()
  }
}))

jest.mock('../../TopicItem', () => ({
  TopicItem: ({ topic, onGenerateName }: any) => {
    const React = require('react')
    const { Pressable, Text, View } = require('react-native')

    return React.createElement(
      View,
      null,
      React.createElement(Text, null, topic.name),
      React.createElement(
        Pressable,
        { onPress: () => onGenerateName?.(topic.id, 'New topic name') },
        React.createElement(Text, null, 'generate-name')
      )
    )
  }
}))

describe('TopicList', () => {
  it('updates the rendered topic name immediately after a generated title is returned', () => {
    render(
      <TopicList
        topics={[
          {
            id: 'topic-1',
            assistantId: 'assistant-1',
            name: 'Old topic name',
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]}
        enableScroll={true}
      />
    )

    expect(screen.getByText('Old topic name')).toBeTruthy()

    fireEvent.press(screen.getByText('generate-name'))

    expect(screen.getByText('New topic name')).toBeTruthy()
  })
})
