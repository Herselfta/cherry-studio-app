import {
  buildMobileSyncAssistantPayload,
  collectPortableSyncImageAssets,
  normalizeMobileSyncExportTopics,
  normalizePortableConversationMessages,
  resolveMobileConversationSync
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

  it('rebuilds assistant topics from the canonical topic table instead of merging stale cached entries', () => {
    const result = buildMobileSyncAssistantPayload({
      assistants: [
        createAssistant({
          id: 'default',
          name: 'Default',
          type: 'system',
          topics: [createTopic({ id: 'stale-default-topic', assistantId: 'default' })]
        }),
        createAssistant({
          id: 'external-1',
          name: 'External One',
          topics: [createTopic({ id: 'stale-external-topic', assistantId: 'external-1' })]
        })
      ],
      fallbackAssistants: [createAssistant({ id: 'default', name: 'Seed Default', type: 'system' })],
      topics: [
        createTopic({ id: 'fresh-default-topic', assistantId: 'default' }),
        createTopic({ id: 'fresh-external-topic', assistantId: 'external-1' })
      ]
    })

    expect(result.defaultAssistant.topics.map(topic => topic.id)).toEqual(['fresh-default-topic'])
    expect(result.assistants.find(assistant => assistant.id === 'external-1')?.topics.map(topic => topic.id)).toEqual([
      'fresh-external-topic'
    ])
  })
})

describe('resolveMobileConversationSync', () => {
  it('collapses fold-selected assistant alternatives into a single portable snapshot response', () => {
    const userMessage = createMessage({
      id: 'user-message',
      assistantId: 'default',
      topicId: 'topic-1',
      role: 'user',
      createdAt: 10
    })
    const oldAssistantMessage = createMessage({
      id: 'assistant-old',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: 20,
      foldSelected: false
    })
    const selectedAssistantMessage = createMessage({
      id: 'assistant-selected',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: 30,
      foldSelected: true
    })

    expect(
      normalizePortableConversationMessages([userMessage, oldAssistantMessage, selectedAssistantMessage]).map(
        message => message.id
      )
    ).toEqual(['user-message', 'assistant-selected'])
  })

  it('keeps multi-model assistant responses when no fold selection state exists', () => {
    const userMessage = createMessage({
      id: 'user-message',
      assistantId: 'default',
      topicId: 'topic-1',
      role: 'user',
      createdAt: 10
    })
    const assistantA = createMessage({
      id: 'assistant-a',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: 20
    })
    const assistantB = createMessage({
      id: 'assistant-b',
      assistantId: 'default',
      topicId: 'topic-1',
      askId: 'user-message',
      createdAt: 30
    })

    expect(
      normalizePortableConversationMessages([userMessage, assistantA, assistantB]).map(message => message.id)
    ).toEqual(['user-message', 'assistant-a', 'assistant-b'])
  })

  it('preserves local-only conversations while deleting entities previously seen from the same source device', () => {
    const result = resolveMobileConversationSync({
      currentTopics: [
        createTopic({ id: 'local-topic', assistantId: 'default' }),
        createTopic({ id: 'shared-topic', assistantId: 'default' }),
        createTopic({ id: 'removed-topic', assistantId: 'default' })
      ],
      incomingTopics: [createTopic({ id: 'shared-topic', assistantId: 'default', updatedAt: 50 })],
      currentMessages: [
        createMessage({ id: 'local-message', assistantId: 'default', topicId: 'local-topic' }),
        createMessage({ id: 'shared-message', assistantId: 'default', topicId: 'shared-topic' }),
        createMessage({ id: 'removed-message', assistantId: 'default', topicId: 'removed-topic' })
      ],
      incomingMessages: [
        createMessage({
          id: 'shared-message',
          assistantId: 'default',
          topicId: 'shared-topic',
          updatedAt: 60
        })
      ],
      currentMessageBlocks: [
        { ...createImageBlock(), id: 'local-block', messageId: 'local-message' },
        { ...createImageBlock(), id: 'shared-block', messageId: 'shared-message' },
        { ...createImageBlock(), id: 'removed-block', messageId: 'removed-message' }
      ],
      incomingMessageBlocks: [{ ...createImageBlock(), id: 'shared-block', messageId: 'shared-message' }],
      exportedAt: 20,
      previousLedgerEntry: {
        lastImportedExportedAt: 10,
        topicIds: ['shared-topic', 'removed-topic'],
        messageIds: ['shared-message', 'removed-message'],
        blockIds: ['shared-block', 'removed-block']
      }
    })

    expect(result.deletedTopicIds).toEqual(['removed-topic'])
    expect(result.deletedMessageIds).toEqual(['removed-message'])
    expect(result.deletedBlockIds).toEqual(['removed-block'])
    expect(result.topics.map(topic => topic.id)).toEqual(expect.arrayContaining(['local-topic', 'shared-topic']))
    expect(result.topics.map(topic => topic.id)).not.toContain('removed-topic')
    expect(result.messages.map(message => message.id)).toEqual(
      expect.arrayContaining(['local-message', 'shared-message'])
    )
    expect(result.nextLedgerEntry).toEqual(
      expect.objectContaining({
        lastImportedExportedAt: 20,
        topicIds: ['shared-topic'],
        messageIds: ['shared-message'],
        blockIds: ['shared-block']
      })
    )
  })

  it('downgrades stale imports to non-destructive merge mode', () => {
    const result = resolveMobileConversationSync({
      currentTopics: [
        createTopic({ id: 'local-topic', assistantId: 'default' }),
        createTopic({ id: 'previously-synced-topic', assistantId: 'default' })
      ],
      incomingTopics: [createTopic({ id: 'local-topic', assistantId: 'default' })],
      currentMessages: [
        createMessage({ id: 'local-message', assistantId: 'default', topicId: 'local-topic' }),
        createMessage({ id: 'previously-synced-message', assistantId: 'default', topicId: 'previously-synced-topic' })
      ],
      incomingMessages: [createMessage({ id: 'local-message', assistantId: 'default', topicId: 'local-topic' })],
      currentMessageBlocks: [
        { ...createImageBlock(), id: 'previously-synced-block', messageId: 'previously-synced-message' }
      ],
      incomingMessageBlocks: [],
      exportedAt: 5,
      previousLedgerEntry: {
        lastImportedExportedAt: 10,
        topicIds: ['previously-synced-topic'],
        messageIds: ['previously-synced-message'],
        blockIds: ['previously-synced-block']
      }
    })

    expect(result.isStaleImport).toBe(true)
    expect(result.deletedTopicIds).toEqual([])
    expect(result.deletedMessageIds).toEqual([])
    expect(result.deletedBlockIds).toEqual([])
    expect(result.topics.map(topic => topic.id)).toEqual(
      expect.arrayContaining(['local-topic', 'previously-synced-topic'])
    )
  })
})
