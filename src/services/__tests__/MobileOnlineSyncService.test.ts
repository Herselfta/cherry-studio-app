import type { Assistant, Topic } from '@/types/assistant'
import type { Message, MessageBlock } from '@/types/message'

import { createEmptyMobileOnlineSyncState } from '../mobileOnlineSyncProtocol'
import { syncMobileOnline } from '../MobileOnlineSyncService'

type FetchRequestInit = Parameters<typeof fetch>[1]

const mockGetAllAssistants = jest.fn<Promise<Assistant[]>, []>()
const mockUpsertAssistants = jest.fn<Promise<unknown>, [Assistant[]]>()
const mockGetTopics = jest.fn<Promise<Topic[]>, []>()
const mockUpsertTopics = jest.fn<Promise<unknown>, [Topic[]]>()
const mockDeleteTopicById = jest.fn<Promise<void>, [string]>()
const mockGetAllMessages = jest.fn<Promise<Message[]>, []>()
const mockUpsertMessages = jest.fn<Promise<unknown>, [Message[]]>()
const mockDeleteMessageById = jest.fn<Promise<void>, [string]>()
const mockGetAllBlocks = jest.fn<Promise<MessageBlock[]>, []>()
const mockUpsertBlocks = jest.fn<Promise<unknown>, [MessageBlock[]]>()
const mockRemoveManyBlocks = jest.fn<Promise<void>, [string[]]>()
const mockPreferenceGet = jest.fn<Promise<any>, [string]>()
const mockPreferenceSet = jest.fn<Promise<void>, [string, any]>()
const mockReadConfig = jest.fn()
const mockReadState = jest.fn()
const mockWriteState = jest.fn()
const mockInvalidateTopicCache = jest.fn()
const mockSyncAfterExternalMutation = jest.fn()
const mockEnsureValidCurrentTopic = jest.fn<Promise<void>, []>()

jest.mock('@database', () => ({
  assistantDatabase: {
    getAllAssistants: () => mockGetAllAssistants(),
    upsertAssistants: (assistants: Assistant[]) => mockUpsertAssistants(assistants)
  },
  topicDatabase: {
    getTopics: () => mockGetTopics(),
    upsertTopics: (topics: Topic[]) => mockUpsertTopics(topics),
    deleteTopicById: (topicId: string) => mockDeleteTopicById(topicId)
  },
  messageDatabase: {
    getAllMessages: () => mockGetAllMessages(),
    upsertMessages: (messages: Message[]) => mockUpsertMessages(messages),
    deleteMessageById: (messageId: string) => mockDeleteMessageById(messageId)
  },
  messageBlockDatabase: {
    getAllBlocks: () => mockGetAllBlocks(),
    upsertBlocks: (blocks: MessageBlock[]) => mockUpsertBlocks(blocks),
    removeManyBlocks: (blockIds: string[]) => mockRemoveManyBlocks(blockIds)
  }
}))

jest.mock('@/config/assistants', () => ({
  getSystemAssistants: () => [
    {
      id: 'default',
      name: 'Default',
      prompt: '',
      type: 'system',
      topics: []
    }
  ]
}))

jest.mock('@/services/PreferenceService', () => ({
  preferenceService: {
    get: (key: string) => mockPreferenceGet(key),
    set: (key: string, value: any) => mockPreferenceSet(key, value)
  }
}))

jest.mock('@/services/MobileOnlineSyncStorage', () => ({
  readMobileOnlineSyncConfig: () => mockReadConfig(),
  readMobileOnlineSyncState: () => mockReadState(),
  writeMobileOnlineSyncState: (state: unknown) => mockWriteState(state)
}))

jest.mock('@/services/TopicService', () => ({
  topicService: {
    invalidateCache: () => mockInvalidateTopicCache()
  }
}))

jest.mock('@/services/AssistantService', () => ({
  assistantService: {
    syncAfterExternalMutation: (assistantIds: string[]) => mockSyncAfterExternalMutation(assistantIds)
  }
}))

jest.mock('@/services/AppInitializationService', () => ({
  ensureValidCurrentTopic: () => mockEnsureValidCurrentTopic()
}))

jest.mock('@/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    })
  }
}))

describe('syncMobileOnline', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock | undefined) = jest.fn()

    mockReadConfig.mockReturnValue({
      baseUrl: 'https://desktop.example.com',
      authToken: 'secret-token'
    })
    mockReadState.mockReturnValue(createEmptyMobileOnlineSyncState('mobile-a'))
    mockGetAllAssistants.mockResolvedValue([
      {
        id: 'default',
        name: 'Default',
        prompt: '',
        type: 'system',
        topics: []
      }
    ])
    mockPreferenceGet.mockImplementation(async (key: string) => {
      if (key === 'user.name') {
        return 'Alice'
      }
      if (key === 'user.avatar') {
        return null
      }
      return null
    })
    mockPreferenceSet.mockResolvedValue(undefined)
    mockEnsureValidCurrentTopic.mockResolvedValue(undefined)
  })

  it('pushes local delta changes and advances the pulled cursor', async () => {
    mockGetTopics.mockResolvedValue([
      {
        id: 'topic-local',
        assistantId: 'default',
        name: 'Local Topic',
        createdAt: 1,
        updatedAt: 1
      }
    ])
    mockGetAllMessages.mockResolvedValue([])
    mockGetAllBlocks.mockResolvedValue([])
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cursor: 1,
          acceptedChanges: JSON.parse(
            ((global.fetch as jest.Mock).mock.calls[0][1] as FetchRequestInit).body as string
          )
            .changes,
          skippedChanges: []
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cursor: 1,
          changes: []
        })
      })

    const result = await syncMobileOnline()

    const pushRequest = (global.fetch as jest.Mock).mock.calls[0]
    expect(pushRequest[0]).toBe('https://desktop.example.com/v1/mobile-sync/push')
    expect(pushRequest[1]?.method).toBe('POST')

    const pushBody = JSON.parse(pushRequest[1]?.body as string)
    expect(pushBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'topic',
          entityId: 'topic-local',
          op: 'upsert'
        })
      ])
    )

    expect((global.fetch as jest.Mock).mock.calls[1]?.[0]).toBe(
      'https://desktop.example.com/v1/mobile-sync/pull?cursor=0'
    )
    expect(mockWriteState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastPulledCursor: 1
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        cursor: 1
      })
    )
  })

  it('applies remote topic tombstones and removes orphaned messages and blocks', async () => {
    mockGetTopics.mockResolvedValue([
      {
        id: 'shared-topic',
        assistantId: 'default',
        name: 'Shared Topic',
        createdAt: 1,
        updatedAt: 1
      }
    ])
    mockGetAllMessages.mockResolvedValue([
      {
        id: 'message-1',
        assistantId: 'default',
        topicId: 'shared-topic',
        role: 'assistant',
        createdAt: 2,
        status: 'success',
        blocks: []
      } as Message
    ])
    mockGetAllBlocks.mockResolvedValue([
      {
        id: 'block-1',
        messageId: 'message-1',
        type: 'main_text',
        createdAt: 3,
        status: 'success',
        content: 'hello'
      } as MessageBlock
    ])
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cursor: 1,
          acceptedChanges: [],
          skippedChanges: []
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cursor: 2,
          changes: [
            {
              entityType: 'topic',
              entityId: 'shared-topic',
              op: 'delete',
              version: {
                replicaId: 'desktop-b',
                lamport: 99
              }
            }
          ]
        })
      })

    await syncMobileOnline()

    expect(mockDeleteTopicById).toHaveBeenCalledWith('shared-topic')
    expect(mockDeleteMessageById).toHaveBeenCalledWith('message-1')
    expect(mockRemoveManyBlocks).toHaveBeenCalledWith(['block-1'])
    expect(mockEnsureValidCurrentTopic).toHaveBeenCalled()
  })
})
