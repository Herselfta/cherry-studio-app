import type { Topic } from '@/types/assistant'
import {
  AssistantMessageStatus,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType
} from '@/types/message'

import { MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY } from '../mobileSyncLedger'
import {
  bootstrapPortableSyncState,
  diagnosePortableSyncVersionDrift,
  PORTABLE_SYNC_STATE_STORAGE_KEY,
  preparePortableSyncState,
  resolvePortableSyncSnapshot,
  seedPortableSyncState,
  toPortableSyncMetadata
} from '../portableSyncState'

const mockModuleStorageState = new Map<string, string>()
const FIXED_TIMESTAMP = 1_775_462_400_000

jest.mock('@/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      warn: jest.fn(),
      info: jest.fn()
    })
  }
}))

jest.mock('@/utils', () => ({
  uuid: () => 'mock-device-id',
  storage: {
    getString: (key: string) => mockModuleStorageState.get(key),
    set: (key: string, value: string) => {
      mockModuleStorageState.set(key, value)
    },
    delete: (key: string) => {
      mockModuleStorageState.delete(key)
    }
  }
}))

type MemoryStorage = {
  getString: (key: string) => string | undefined
  set: (key: string, value: string) => void
  delete: (key: string) => void
}

function createMemoryStorage(): MemoryStorage {
  const state = new Map<string, string>()

  return {
    getString(key: string) {
      return state.get(key)
    },
    set(key: string, value: string) {
      state.set(key, value)
    },
    delete(key: string) {
      state.delete(key)
    }
  }
}

function createTopic(overrides: Partial<Topic> & Pick<Topic, 'id' | 'assistantId'>): Topic {
  return {
    id: overrides.id,
    assistantId: overrides.assistantId,
    name: overrides.name || overrides.id,
    createdAt: overrides.createdAt || FIXED_TIMESTAMP,
    updatedAt: overrides.updatedAt || FIXED_TIMESTAMP,
    ...overrides
  }
}

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'assistantId' | 'topicId'>): Message {
  return {
    id: overrides.id,
    assistantId: overrides.assistantId,
    topicId: overrides.topicId,
    role: 'assistant',
    createdAt: overrides.createdAt || FIXED_TIMESTAMP,
    updatedAt: overrides.updatedAt,
    status: AssistantMessageStatus.SUCCESS,
    blocks: [],
    ...overrides
  }
}

function createBlock(messageId: string, id = `block:${messageId}`) {
  return {
    id,
    messageId,
    type: MessageBlockType.MAIN_TEXT,
    status: MessageBlockStatus.SUCCESS,
    content: 'content',
    createdAt: FIXED_TIMESTAMP
  }
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => stripUndefinedDeep(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, childValue]) =>
        childValue === undefined ? [] : [[key, stripUndefinedDeep(childValue)]]
      )
    ) as T
  }

  return value
}

describe('portableSyncState', () => {
  beforeEach(() => {
    mockModuleStorageState.clear()
  })

  it('preserves local-only topics when the incoming snapshot has never seen them', () => {
    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const localTopic = createTopic({ id: 'local-only-topic', assistantId: 'default' })
    const localState = preparePortableSyncState(
      {
        topics: [localTopic],
        messages: [],
        messageBlocks: []
      },
      localStorage
    )
    const remoteState = preparePortableSyncState(
      {
        topics: [],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [localTopic],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.topics.map(topic => topic.id)).toEqual(['local-only-topic'])
    expect(result.deletedTopicIds).toEqual([])
  })

  it('deletes topics only when a newer remote tombstone exists', () => {
    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })
    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const localState = preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      localStorage
    )

    preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )
    const remoteDeletionState = preparePortableSyncState(
      {
        topics: [],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [sharedTopic],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteDeletionState)
    })

    expect(result.topics).toEqual([])
    expect(result.deletedTopicIds).toEqual(['shared-topic'])
  })

  it('bootstraps migration-seeded topics against incoming tombstones without resurrecting them', () => {
    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })
    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )
    const remoteDeletionState = preparePortableSyncState(
      {
        topics: [],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )
    const localState = bootstrapPortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      toPortableSyncMetadata(remoteDeletionState),
      localStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [sharedTopic],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteDeletionState)
    })

    expect(result.topics).toEqual([])
    expect(result.deletedTopicIds).toEqual(['shared-topic'])
  })

  it('prefers incoming tracked topic metadata on version tie during bootstrap recovery', () => {
    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const localTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default',
      name: 'mobile stale title'
    })
    const remoteTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default',
      name: 'desktop newer title'
    })
    const sharedMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: 'shared-topic',
      role: 'user'
    })
    const sharedBlock = createBlock(sharedMessage.id)

    const remoteState = preparePortableSyncState(
      {
        topics: [remoteTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      remoteStorage
    )
    const localState = bootstrapPortableSyncState(
      {
        topics: [localTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      toPortableSyncMetadata(remoteState),
      localStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [localTopic],
      incomingTopics: [remoteTopic],
      currentMessages: [sharedMessage],
      incomingMessages: [sharedMessage],
      currentMessageBlocks: [sharedBlock],
      incomingMessageBlocks: [sharedBlock],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState),
      preferIncomingOnEqualVersion: true
    })

    expect(result.topics).toEqual([expect.objectContaining({ id: 'shared-topic', name: 'desktop newer title' })])
  })

  it('seeds restored sync lineage so later remote tombstones can delete migrated topics', () => {
    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })
    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const remoteSeedState = preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    seedPortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      toPortableSyncMetadata(remoteSeedState),
      localStorage
    )

    const remoteDeletionState = preparePortableSyncState(
      {
        topics: [],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )
    const localState = preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [],
        messageBlocks: []
      },
      localStorage,
      toPortableSyncMetadata(remoteDeletionState).frontier
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [sharedTopic],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteDeletionState)
    })

    expect(result.topics).toEqual([])
    expect(result.deletedTopicIds).toEqual(['shared-topic'])
  })

  it('prunes remotely tracked empty ghost topics while keeping local-only empty topics', () => {
    const sharedTopic = createTopic({ id: 'shared-topic', assistantId: 'default', name: 'shared topic' })
    const locallyRetitledSharedTopic = createTopic({
      id: 'shared-topic',
      assistantId: 'default',
      name: 'locally retitled topic',
      updatedAt: 999
    })
    const localOnlyTopic = createTopic({ id: 'local-only-topic', assistantId: 'default', name: 'local empty topic' })
    const sharedMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: 'shared-topic',
      role: 'user'
    })
    const sharedBlock = createBlock(sharedMessage.id)
    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const remoteSeedState = preparePortableSyncState(
      {
        topics: [sharedTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      remoteStorage
    )

    seedPortableSyncState(
      {
        topics: [sharedTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      toPortableSyncMetadata(remoteSeedState),
      localStorage
    )

    const remoteDeletionState = preparePortableSyncState(
      {
        topics: [],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    const localState = preparePortableSyncState(
      {
        topics: [locallyRetitledSharedTopic, localOnlyTopic],
        messages: [sharedMessage],
        messageBlocks: [sharedBlock]
      },
      localStorage,
      toPortableSyncMetadata(remoteDeletionState).frontier
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [locallyRetitledSharedTopic, localOnlyTopic],
      incomingTopics: [],
      currentMessages: [sharedMessage],
      incomingMessages: [],
      currentMessageBlocks: [sharedBlock],
      incomingMessageBlocks: [],
      localState,
      incomingSync: toPortableSyncMetadata(remoteDeletionState)
    })

    expect(result.topics).toEqual([expect.objectContaining({ id: 'local-only-topic' })])
    expect(result.deletedTopicIds).toContain('shared-topic')
    expect(result.deletedTopicIds).not.toContain('local-only-topic')
    expect(result.deletedMessageIds).toContain('shared-message')
    expect(result.deletedBlockIds).toContain(sharedBlock.id)
  })

  it('ignores topic versions that no longer have a normalized incoming topic entity', () => {
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const remoteTopic = createTopic({ id: 'filtered-topic', assistantId: 'default' })
    const remoteState = preparePortableSyncState(
      {
        topics: [remoteTopic],
        messages: [],
        messageBlocks: []
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [],
      incomingTopics: [],
      currentMessages: [],
      incomingMessages: [],
      currentMessageBlocks: [],
      incomingMessageBlocks: [],
      localState: preparePortableSyncState(
        {
          topics: [],
          messages: [],
          messageBlocks: []
        },
        createMemoryStorage()
      ),
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.topics).toEqual([])
    expect(result.deletedTopicIds).toEqual([])
  })

  it('treats omitted optional fields as the same fingerprint when merging newer remote edits', () => {
    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const baseTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })
    const baseMessage = {
      ...createMessage({
        id: 'shared-message',
        assistantId: 'default',
        topicId: baseTopic.id,
        content: 'original content'
      }),
      modelId: undefined,
      mentions: undefined
    } satisfies Message
    const baseBlock = {
      ...createBlock(baseMessage.id, 'shared-block'),
      content: 'original block',
      updatedAt: undefined,
      file: undefined
    } satisfies MessageBlock

    preparePortableSyncState(
      {
        topics: [baseTopic],
        messages: [baseMessage],
        messageBlocks: [baseBlock]
      },
      localStorage
    )

    preparePortableSyncState(
      {
        topics: [stripUndefinedDeep(baseTopic)],
        messages: [stripUndefinedDeep(baseMessage)],
        messageBlocks: [stripUndefinedDeep(baseBlock)]
      },
      remoteStorage
    )

    const remoteTopic = createTopic({
      ...stripUndefinedDeep(baseTopic),
      name: 'desktop renamed topic',
      updatedAt: Date.now() + 3000
    })
    const remoteMessage = createMessage({
      ...stripUndefinedDeep(baseMessage),
      content: 'desktop newer content',
      updatedAt: Date.now() + 3000
    })
    const remoteBlock = {
      ...stripUndefinedDeep(baseBlock),
      content: 'desktop newer block',
      updatedAt: Date.now() + 3000
    } satisfies MessageBlock
    const remoteState = preparePortableSyncState(
      {
        topics: [remoteTopic],
        messages: [remoteMessage],
        messageBlocks: [remoteBlock]
      },
      remoteStorage
    )

    const currentLocalTopic = stripUndefinedDeep(baseTopic)
    const currentLocalMessage = stripUndefinedDeep(baseMessage)
    const currentLocalBlock = stripUndefinedDeep(baseBlock)
    const localState = preparePortableSyncState(
      {
        topics: [currentLocalTopic],
        messages: [currentLocalMessage],
        messageBlocks: [currentLocalBlock]
      },
      localStorage,
      toPortableSyncMetadata(remoteState).frontier
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [currentLocalTopic],
      incomingTopics: [remoteTopic],
      currentMessages: [currentLocalMessage],
      incomingMessages: [remoteMessage],
      currentMessageBlocks: [currentLocalBlock],
      incomingMessageBlocks: [remoteBlock],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.topics).toEqual([expect.objectContaining({ id: 'shared-topic', name: 'desktop renamed topic' })])
    expect(result.messages).toEqual([
      expect.objectContaining({ id: 'shared-message', content: 'desktop newer content' })
    ])
    expect(result.messageBlocks).toEqual([
      expect.objectContaining({ id: 'shared-block', content: 'desktop newer block' })
    ])
  })

  it('keeps only the latest assistant slot winner across replicas', () => {
    const topic = createTopic({ id: 'topic-1', assistantId: 'default' })
    const userMessage = createMessage({
      id: 'user-1',
      assistantId: 'default',
      topicId: topic.id,
      role: 'user'
    })
    const oldAssistantMessage = createMessage({
      id: 'assistant-old',
      assistantId: 'default',
      topicId: topic.id,
      askId: 'user-1',
      foldSelected: true,
      createdAt: 10
    })
    const newAssistantMessage = createMessage({
      id: 'assistant-new',
      assistantId: 'default',
      topicId: topic.id,
      askId: 'user-1',
      foldSelected: true,
      createdAt: 20
    })

    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const localState = preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, oldAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)]
      },
      localStorage
    )
    preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, oldAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)]
      },
      remoteStorage
    )
    const remoteState = preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, newAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(newAssistantMessage.id)]
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [topic],
      incomingTopics: [topic],
      currentMessages: [userMessage, oldAssistantMessage],
      incomingMessages: [userMessage, newAssistantMessage],
      currentMessageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)],
      incomingMessageBlocks: [createBlock(userMessage.id), createBlock(newAssistantMessage.id)],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.messages.map(message => message.id).sort()).toEqual(['assistant-new', 'user-1'])
    expect(result.deletedMessageIds).toContain('assistant-old')
  })

  it('suppresses same-model assistant retries even without explicit fold selection metadata', () => {
    const topic = createTopic({ id: 'topic-1', assistantId: 'default' })
    const userMessage = createMessage({
      id: 'user-1',
      assistantId: 'default',
      topicId: topic.id,
      role: 'user'
    })
    const oldAssistantMessage = createMessage({
      id: 'assistant-old',
      assistantId: 'default',
      topicId: topic.id,
      askId: 'user-1',
      modelId: 'same-model',
      createdAt: 10
    })
    const newAssistantMessage = createMessage({
      id: 'assistant-new',
      assistantId: 'default',
      topicId: topic.id,
      askId: 'user-1',
      modelId: 'same-model',
      createdAt: 20
    })

    const localStorage = createMemoryStorage()
    localStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const remoteStorage = createMemoryStorage()
    remoteStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const localState = preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, oldAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)]
      },
      localStorage
    )
    preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, oldAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)]
      },
      remoteStorage
    )
    const remoteState = preparePortableSyncState(
      {
        topics: [topic],
        messages: [userMessage, newAssistantMessage],
        messageBlocks: [createBlock(userMessage.id), createBlock(newAssistantMessage.id)]
      },
      remoteStorage
    )

    const result = resolvePortableSyncSnapshot({
      currentTopics: [topic],
      incomingTopics: [topic],
      currentMessages: [userMessage, oldAssistantMessage],
      incomingMessages: [userMessage, newAssistantMessage],
      currentMessageBlocks: [createBlock(userMessage.id), createBlock(oldAssistantMessage.id)],
      incomingMessageBlocks: [createBlock(userMessage.id), createBlock(newAssistantMessage.id)],
      localState,
      incomingSync: toPortableSyncMetadata(remoteState)
    })

    expect(result.messages.map(message => message.id).sort()).toEqual(['assistant-new', 'user-1'])
    expect(result.deletedMessageIds).toContain('assistant-old')
  })

  it('ignores platform-specific fields when computing portable sync fingerprints', () => {
    const storage = createMemoryStorage()
    storage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')

    const richTopic = {
      ...createTopic({ id: 'shared-topic', assistantId: 'default' }),
      isLoading: true
    }
    const portableTopic = createTopic({ id: 'shared-topic', assistantId: 'default' })

    const richMessage = {
      ...createMessage({
        id: 'shared-message',
        assistantId: 'default',
        topicId: 'shared-topic',
        blocks: ['shared-block'],
        modelId: 'gpt-5'
      }),
      model: { id: 'gpt-5', provider: 'openai', name: 'GPT-5', group: 'default' },
      usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
      metrics: { completion_tokens: 1, time_completion_millsec: 10 },
      traceId: 'trace-mobile-only'
    }
    const portableMessage = createMessage({
      id: 'shared-message',
      assistantId: 'default',
      topicId: 'shared-topic',
      blocks: ['shared-block'],
      modelId: 'gpt-5'
    })

    const richBlock = {
      id: 'shared-block',
      messageId: 'shared-message',
      type: MessageBlockType.IMAGE,
      status: MessageBlockStatus.SUCCESS,
      createdAt: 1,
      updatedAt: 2,
      url: 'file:///mobile/private/path/image.png',
      file: {
        id: 'file-1',
        name: 'image.png',
        origin_name: 'image.png',
        path: '/mobile/private/path/image.png',
        size: 123,
        ext: '.png',
        type: 'image',
        created_at: 1,
        count: 1
      }
    }
    const portableBlock = {
      id: 'shared-block',
      messageId: 'shared-message',
      type: MessageBlockType.IMAGE,
      status: MessageBlockStatus.SUCCESS,
      createdAt: 1,
      updatedAt: 2,
      file: {
        id: 'file-1',
        name: 'image.png',
        origin_name: 'image.png',
        path: '/desktop/different/path/image.png',
        size: 123,
        ext: '.png',
        type: 'image',
        created_at: 1,
        count: 1
      }
    }

    const firstState = preparePortableSyncState(
      {
        topics: [richTopic],
        messages: [richMessage],
        messageBlocks: [richBlock]
      },
      storage
    )
    const secondState = preparePortableSyncState(
      {
        topics: [portableTopic],
        messages: [portableMessage],
        messageBlocks: [portableBlock]
      },
      storage
    )

    expect(secondState.entityVersions.topics['shared-topic']).toEqual(firstState.entityVersions.topics['shared-topic'])
    expect(secondState.entityVersions.messages['shared-message']).toEqual(
      firstState.entityVersions.messages['shared-message']
    )
    expect(secondState.entityVersions.blocks['shared-block']).toEqual(firstState.entityVersions.blocks['shared-block'])
  })

  it('migrates legacy fingerprint state without inflating tracked versions', () => {
    const targetStorage = createMemoryStorage()
    targetStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-b')

    const snapshot = {
      topics: [createTopic({ id: 'shared-topic', assistantId: 'default', name: 'shared' })],
      messages: [
        createMessage({
          id: 'shared-message',
          assistantId: 'default',
          topicId: 'shared-topic',
          blocks: ['shared-block']
        })
      ],
      messageBlocks: [createBlock('shared-message', 'shared-block')]
    }

    const firstState = preparePortableSyncState(snapshot, targetStorage)
    const legacyState = JSON.parse(targetStorage.getString(PORTABLE_SYNC_STATE_STORAGE_KEY) || '{}')
    delete legacyState.fingerprintVersion
    legacyState.fingerprints = {
      topics: { 'shared-topic': 'legacy-topic-fingerprint' },
      messages: { 'shared-message': 'legacy-message-fingerprint' },
      blocks: { 'shared-block': 'legacy-block-fingerprint' },
      messageSlots: {}
    }
    targetStorage.set(PORTABLE_SYNC_STATE_STORAGE_KEY, JSON.stringify(legacyState))

    const secondState = preparePortableSyncState(snapshot, targetStorage)

    expect(secondState.entityVersions.topics['shared-topic']).toEqual(firstState.entityVersions.topics['shared-topic'])
    expect(secondState.entityVersions.messages['shared-message']).toEqual(
      firstState.entityVersions.messages['shared-message']
    )
    expect(secondState.entityVersions.blocks['shared-block']).toEqual(firstState.entityVersions.blocks['shared-block'])
  })

  it('detects and repairs shared lineage drift for small lagging mobile datasets', () => {
    const mobileStorage = createMemoryStorage()
    mobileStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'mobile-a')
    const desktopStorage = createMemoryStorage()
    desktopStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, 'desktop-b')

    const sharedEntries = Array.from({ length: 3 }, (_, index) => {
      const topicId = `shared-topic-small-${index}`
      const messageId = `shared-message-small-${index}`
      const blockId = `shared-block-small-${index}`

      return {
        topic: createTopic({ id: topicId, assistantId: 'default', name: `shared topic ${index}` }),
        message: createMessage({
          id: messageId,
          assistantId: 'default',
          topicId,
          role: 'user',
          content: `shared message ${index}`,
          blocks: [blockId]
        }),
        block: {
          ...createBlock(messageId, blockId),
          content: `shared block ${index}`
        } satisfies MessageBlock
      }
    })

    const deletedTopic = createTopic({ id: 'deleted-topic-small', assistantId: 'default', name: 'delete me' })
    const deletedMessage = createMessage({
      id: 'deleted-message-small',
      assistantId: 'default',
      topicId: deletedTopic.id,
      role: 'user',
      content: 'delete message',
      blocks: ['deleted-block-small']
    })
    const deletedBlock = {
      ...createBlock(deletedMessage.id, 'deleted-block-small'),
      content: 'delete block'
    } satisfies MessageBlock

    const initialMobileSnapshot = {
      topics: [...sharedEntries.map(entry => entry.topic), deletedTopic],
      messages: [...sharedEntries.map(entry => entry.message), deletedMessage],
      messageBlocks: [...sharedEntries.map(entry => entry.block), deletedBlock]
    }

    const mobileSeedState = preparePortableSyncState(initialMobileSnapshot, mobileStorage)
    bootstrapPortableSyncState(initialMobileSnapshot, toPortableSyncMetadata(mobileSeedState), desktopStorage)

    const desktopSnapshot = {
      topics: [
        createTopic({
          ...sharedEntries[0].topic,
          name: 'desktop renamed topic',
          updatedAt: FIXED_TIMESTAMP + 5_000
        }),
        ...sharedEntries.slice(1).map(entry => entry.topic),
        createTopic({
          id: 'desktop-new-topic-small',
          assistantId: 'default',
          name: 'brand new on desktop',
          updatedAt: FIXED_TIMESTAMP + 6_000
        })
      ],
      messages: [
        createMessage({
          ...sharedEntries[0].message,
          content: 'desktop updated content',
          updatedAt: FIXED_TIMESTAMP + 5_000
        }),
        ...sharedEntries.slice(1).map(entry => entry.message),
        createMessage({
          id: 'desktop-new-message-small',
          assistantId: 'default',
          topicId: 'desktop-new-topic-small',
          role: 'user',
          content: 'brand new message',
          blocks: ['desktop-new-block-small']
        })
      ],
      messageBlocks: [
        {
          ...sharedEntries[0].block,
          content: 'desktop updated block',
          updatedAt: FIXED_TIMESTAMP + 5_000
        } satisfies MessageBlock,
        ...sharedEntries.slice(1).map(entry => entry.block),
        {
          ...createBlock('desktop-new-message-small', 'desktop-new-block-small'),
          content: 'brand new block'
        } satisfies MessageBlock
      ]
    }
    const desktopState = preparePortableSyncState(
      desktopSnapshot,
      desktopStorage,
      toPortableSyncMetadata(mobileSeedState).frontier
    )

    const pollutedState = JSON.parse(mobileStorage.getString(PORTABLE_SYNC_STATE_STORAGE_KEY) || '{}')
    let nextLamport = 120
    pollutedState.lamport = nextLamport
    pollutedState.frontier['mobile-a'] = nextLamport
    for (const topic of initialMobileSnapshot.topics) {
      pollutedState.entityVersions.topics[topic.id] = { replicaId: 'mobile-a', lamport: nextLamport-- }
    }
    for (const message of initialMobileSnapshot.messages) {
      pollutedState.entityVersions.messages[message.id] = { replicaId: 'mobile-a', lamport: nextLamport-- }
    }
    for (const block of initialMobileSnapshot.messageBlocks) {
      pollutedState.entityVersions.blocks[block.id] = { replicaId: 'mobile-a', lamport: nextLamport-- }
    }
    mobileStorage.set(PORTABLE_SYNC_STATE_STORAGE_KEY, JSON.stringify(pollutedState))

    const driftedLocalState = preparePortableSyncState(
      initialMobileSnapshot,
      mobileStorage,
      toPortableSyncMetadata(desktopState).frontier
    )
    const diagnosis = diagnosePortableSyncVersionDrift({
      currentTopics: initialMobileSnapshot.topics,
      incomingTopics: desktopSnapshot.topics,
      currentMessages: initialMobileSnapshot.messages,
      incomingMessages: desktopSnapshot.messages,
      currentMessageBlocks: initialMobileSnapshot.messageBlocks,
      incomingMessageBlocks: desktopSnapshot.messageBlocks,
      localState: driftedLocalState,
      incomingSync: toPortableSyncMetadata(desktopState)
    })

    expect(diagnosis.suspected).toBe(true)
    expect(diagnosis.inflatedEntityCount).toBeGreaterThanOrEqual(3)

    const repairedLocalState = bootstrapPortableSyncState(
      initialMobileSnapshot,
      toPortableSyncMetadata(desktopState),
      mobileStorage
    )
    const result = resolvePortableSyncSnapshot({
      currentTopics: initialMobileSnapshot.topics,
      incomingTopics: desktopSnapshot.topics,
      currentMessages: initialMobileSnapshot.messages,
      incomingMessages: desktopSnapshot.messages,
      currentMessageBlocks: initialMobileSnapshot.messageBlocks,
      incomingMessageBlocks: desktopSnapshot.messageBlocks,
      localState: repairedLocalState,
      incomingSync: toPortableSyncMetadata(desktopState),
      preferIncomingOnEqualVersion: true
    })

    expect(result.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-topic-small-0', name: 'desktop renamed topic' }),
        expect.objectContaining({ id: 'desktop-new-topic-small', name: 'brand new on desktop' })
      ])
    )
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-message-small-0', content: 'desktop updated content' }),
        expect.objectContaining({ id: 'desktop-new-message-small', content: 'brand new message' })
      ])
    )
    expect(result.messageBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared-block-small-0', content: 'desktop updated block' }),
        expect.objectContaining({ id: 'desktop-new-block-small', content: 'brand new block' })
      ])
    )
    expect(result.deletedTopicIds).toContain('deleted-topic-small')
    expect(result.deletedMessageIds).toContain('deleted-message-small')
    expect(result.deletedBlockIds).toContain('deleted-block-small')
  })
})
