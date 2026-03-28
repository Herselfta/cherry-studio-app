import {
  buildMobileSyncAssistantPayload,
  collectPortableSyncImageAssets,
  normalizeMobileSyncExportTopics
} from '@/services/mobileSyncUtils'
import type { Assistant, Topic } from '@/types/assistant'
import { FileTypes } from '@/types/file'
import { AssistantMessageStatus, type Message } from '@/types/message'
import { MessageBlockStatus, MessageBlockType } from '@/types/message'

function createTopic(overrides: Partial<Topic> & Pick<Topic, 'id' | 'assistantId'>): Topic {
  return {
    name: overrides.name || overrides.id,
    createdAt: overrides.createdAt || Date.now(),
    updatedAt: overrides.updatedAt || Date.now(),
    ...overrides,
    id: overrides.id,
    assistantId: overrides.assistantId
  }
}

function createAssistant(overrides: Partial<Assistant> & Pick<Assistant, 'id' | 'name'>): Assistant {
  return {
    prompt: '',
    topics: [],
    type: 'external',
    ...overrides,
    id: overrides.id,
    name: overrides.name
  }
}

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'assistantId' | 'topicId'>): Message {
  return {
    role: 'assistant',
    createdAt: overrides.createdAt || Date.now(),
    updatedAt: overrides.updatedAt,
    status: AssistantMessageStatus.SUCCESS,
    blocks: [],
    ...overrides,
    id: overrides.id,
    assistantId: overrides.assistantId,
    topicId: overrides.topicId
  }
}

function createImageBlock() {
  return {
    id: 'block-1',
    messageId: 'message-1',
    type: MessageBlockType.IMAGE,
    createdAt: Date.now(),
    status: MessageBlockStatus.SUCCESS,
    file: {
      id: 'image-file-1',
      name: 'photo',
      origin_name: 'photo.png',
      path: '/tmp/photo.png',
      ext: '.png',
      type: FileTypes.IMAGE,
      size: 1,
      created_at: Date.now(),
      count: 1
    }
  } as const
}

describe('buildMobileSyncAssistantPayload', () => {
  it('rebuilds assistant topics from normalized visible topics without exporting helper assistants', () => {
    const normalizedTopics = normalizeMobileSyncExportTopics({
      assistants: [
        createAssistant({ id: 'default', name: 'Default', type: 'system', topics: [] }),
        createAssistant({ id: 'external-1', name: 'External One', topics: [] })
      ],
      topics: [
        createTopic({ id: 'default-topic', assistantId: 'default' }),
        createTopic({ id: 'external-topic', assistantId: 'quick' })
      ],
      messages: [
        createMessage({ id: 'message-1', topicId: 'external-topic', assistantId: 'external-1' }),
        createMessage({ id: 'message-2', topicId: 'helper-topic', assistantId: 'quick' })
      ]
    })

    const result = buildMobileSyncAssistantPayload({
      assistants: [
        createAssistant({ id: 'default', name: 'Default', type: 'system', topics: [] }),
        createAssistant({ id: 'external-1', name: 'External One', topics: [] })
      ],
      fallbackAssistants: [createAssistant({ id: 'default', name: 'Seed Default', type: 'system' })],
      topics: normalizedTopics
    })

    expect(result.defaultAssistant.topics).toEqual([expect.objectContaining({ id: 'default-topic' })])
    expect(result.assistants.find(assistant => assistant.id === 'external-1')?.topics).toEqual([
      expect.objectContaining({ id: 'external-topic' })
    ])
    expect(normalizedTopics.map(topic => topic.id)).toEqual(expect.arrayContaining(['default-topic', 'external-topic']))
    expect(normalizedTopics.map(topic => topic.id)).not.toContain('helper-topic')
    expect(result.assistants.find(assistant => assistant.id === 'quick')).toBeUndefined()
  })

  it('inlines uploaded image bytes for cross-device mobile sync', () => {
    const portableImageAssets = collectPortableSyncImageAssets([createImageBlock()], () => 'mobile-image-base64')

    expect(portableImageAssets).toEqual([
      expect.objectContaining({
        fileId: 'image-file-1',
        data: 'data:image/png;base64,mobile-image-base64'
      })
    ])
  })

  it('exports per-assistant runtime model fields in the mobile sync payload', () => {
    const runtimeModel = {
      id: 'external-runtime-model',
      provider: 'openrouter',
      name: 'External Runtime Model',
      group: 'chat'
    }
    const assistantDefaultModel = {
      id: 'external-default-model',
      provider: 'anthropic',
      name: 'External Default Model',
      group: 'assistant-default'
    }
    const defaultAssistantModel = {
      id: 'default-runtime-model',
      provider: 'openai',
      name: 'Default Runtime Model',
      group: 'default'
    }

    const result = buildMobileSyncAssistantPayload({
      assistants: [
        createAssistant({
          id: 'default',
          name: 'Default',
          type: 'system',
          model: defaultAssistantModel,
          defaultModel: defaultAssistantModel,
          topics: []
        }),
        createAssistant({
          id: 'external-1',
          name: 'External One',
          model: runtimeModel,
          defaultModel: assistantDefaultModel,
          topics: []
        })
      ],
      fallbackAssistants: [createAssistant({ id: 'default', name: 'Seed Default', type: 'system' })],
      topics: []
    })

    expect(result.defaultAssistant).toEqual(
      expect.objectContaining({
        model: defaultAssistantModel,
        defaultModel: defaultAssistantModel
      })
    )
    expect(result.assistants.find(assistant => assistant.id === 'external-1')).toEqual(
      expect.objectContaining({
        model: runtimeModel,
        defaultModel: assistantDefaultModel
      })
    )
  })
})
