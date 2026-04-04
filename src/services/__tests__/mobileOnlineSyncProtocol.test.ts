import {
  applyMobileOnlineSyncChanges,
  buildMobileOnlineSyncChanges,
  createEmptyMobileOnlineSyncState,
  markMobileOnlineSyncChangesPublished,
  MOBILE_ONLINE_SYNC_PROFILE_ID,
  type MobileOnlineSyncSnapshot,
  prepareMobileOnlineSyncState} from '@/services/mobileOnlineSyncProtocol'

function createSnapshot(overrides?: Partial<MobileOnlineSyncSnapshot>): MobileOnlineSyncSnapshot {
  return {
    profile: {
      id: MOBILE_ONLINE_SYNC_PROFILE_ID,
      userName: 'tester'
    },
    assistants: [
      {
        id: 'default',
        name: 'Default',
        prompt: '',
        type: 'system',
        topics: []
      }
    ],
    topics: [],
    messages: [],
    messageBlocks: [],
    ...overrides
  }
}

describe('mobileOnlineSyncProtocol', () => {
  it('keeps local topics when incoming deltas do not mention them', () => {
    const snapshot = createSnapshot({
      topics: [
        {
          id: 'topic-local',
          assistantId: 'default',
          name: 'Local Topic',
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })

    const prepared = prepareMobileOnlineSyncState(snapshot, createEmptyMobileOnlineSyncState('mobile-a'))
    const result = applyMobileOnlineSyncChanges(prepared.snapshot, prepared.state, [])

    expect(result.snapshot.topics.map(topic => topic.id)).toEqual(['topic-local'])
  })

  it('emits and applies tombstones for topic deletes with cascading cleanup', () => {
    const topic = {
      id: 'topic-1',
      assistantId: 'default',
      name: 'Topic One',
      createdAt: 1,
      updatedAt: 1
    }
    const message = {
      id: 'message-1',
      assistantId: 'default',
      topicId: topic.id,
      role: 'assistant' as const,
      createdAt: 2,
      blocks: []
    }
    const block = {
      id: 'block-1',
      messageId: message.id,
      type: 'main_text',
      createdAt: 3,
      status: 'success',
      content: 'hello'
    }

    const basePrepared = prepareMobileOnlineSyncState(
      createSnapshot({
        topics: [topic],
        messages: [message],
        messageBlocks: [block]
      }),
      createEmptyMobileOnlineSyncState('mobile-a')
    )
    const publishedState = markMobileOnlineSyncChangesPublished(
      basePrepared.state,
      buildMobileOnlineSyncChanges(basePrepared.snapshot, basePrepared.state)
    )
    const deletedPrepared = prepareMobileOnlineSyncState(createSnapshot(), publishedState)
    const topicDelete = buildMobileOnlineSyncChanges(deletedPrepared.snapshot, deletedPrepared.state).find(
      change => change.entityType === 'topic' && change.entityId === topic.id
    )

    expect(topicDelete).toEqual(expect.objectContaining({ op: 'delete' }))

    const result = applyMobileOnlineSyncChanges(basePrepared.snapshot, basePrepared.state, [topicDelete!])
    expect(result.snapshot.topics).toEqual([])
    expect(result.snapshot.messages).toEqual([])
    expect(result.snapshot.messageBlocks).toEqual([])
  })

  it('rejects stale incoming topic updates when local is newer', () => {
    const oldSnapshot = createSnapshot({
      topics: [
        {
          id: 'topic-1',
          assistantId: 'default',
          name: 'Old Name',
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })
    const localPrepared = prepareMobileOnlineSyncState(oldSnapshot, createEmptyMobileOnlineSyncState('mobile-a'))
    const localUpdated = prepareMobileOnlineSyncState(
      createSnapshot({
        topics: [
          {
            id: 'topic-1',
            assistantId: 'default',
            name: 'Local New Name',
            createdAt: 1,
            updatedAt: 2
          }
        ]
      }),
      localPrepared.state
    )

    const remotePrepared = prepareMobileOnlineSyncState(oldSnapshot, createEmptyMobileOnlineSyncState('desktop-b'))
    const staleTopicChange = buildMobileOnlineSyncChanges(remotePrepared.snapshot, remotePrepared.state).find(
      change => change.entityType === 'topic' && change.entityId === 'topic-1'
    )

    const result = applyMobileOnlineSyncChanges(localUpdated.snapshot, localUpdated.state, [staleTopicChange!])

    expect(result.snapshot.topics[0]?.name).toBe('Local New Name')
    expect(result.skippedChanges).toEqual([
      expect.objectContaining({
        reason: 'stale_change'
      })
    ])
  })
})
