import type { Topic } from '@/types/assistant'
import { AssistantMessageStatus, type Message, MessageBlockStatus, MessageBlockType } from '@/types/message'

import { MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY } from '../mobileSyncLedger'
import {
  bootstrapPortableSyncState,
  preparePortableSyncState,
  resolvePortableSyncSnapshot,
  seedPortableSyncState,
  toPortableSyncMetadata
} from '../portableSyncState'

const mockModuleStorageState = new Map<string, string>()

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
    createdAt: overrides.createdAt || Date.now(),
    updatedAt: overrides.updatedAt || Date.now(),
    ...overrides
  }
}

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'assistantId' | 'topicId'>): Message {
  return {
    id: overrides.id,
    assistantId: overrides.assistantId,
    topicId: overrides.topicId,
    role: 'assistant',
    createdAt: overrides.createdAt || Date.now(),
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
    createdAt: Date.now()
  }
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
})
