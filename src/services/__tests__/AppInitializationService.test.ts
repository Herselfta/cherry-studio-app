import { resolveValidCurrentTopicId } from '@/services/currentTopicUtils'
import type { Topic } from '@/types/assistant'

function createTopic(overrides: Partial<Topic> & Pick<Topic, 'id' | 'assistantId'>): Topic {
  return {
    id: overrides.id,
    assistantId: overrides.assistantId,
    name: overrides.name || overrides.id,
    createdAt: overrides.createdAt || 1,
    updatedAt: overrides.updatedAt || overrides.createdAt || 1,
    ...overrides
  }
}

describe('AppInitializationService.resolveValidCurrentTopicId', () => {
  it('keeps the current topic when both the topic and its assistant still exist', () => {
    const topicId = resolveValidCurrentTopicId({
      currentTopicId: 'topic-1',
      topics: [createTopic({ id: 'topic-1', assistantId: 'assistant-a', updatedAt: 10 })],
      validAssistantIds: new Set(['assistant-a'])
    })

    expect(topicId).toBe('topic-1')
  })

  it('falls back to the newest topic with a valid assistant when the current topic was removed', () => {
    const topicId = resolveValidCurrentTopicId({
      currentTopicId: 'missing-topic',
      topics: [
        createTopic({ id: 'topic-older', assistantId: 'assistant-a', updatedAt: 10 }),
        createTopic({ id: 'topic-newer', assistantId: 'assistant-b', updatedAt: 20 })
      ],
      validAssistantIds: new Set(['assistant-a', 'assistant-b'])
    })

    expect(topicId).toBe('topic-newer')
  })

  it('skips topics whose assistant no longer exists', () => {
    const topicId = resolveValidCurrentTopicId({
      currentTopicId: 'topic-stale',
      topics: [
        createTopic({ id: 'topic-stale', assistantId: 'missing-assistant', updatedAt: 30 }),
        createTopic({ id: 'topic-valid', assistantId: 'assistant-a', updatedAt: 20 })
      ],
      validAssistantIds: new Set(['assistant-a'])
    })

    expect(topicId).toBe('topic-valid')
  })

  it('returns null when there is no remaining topic with a valid assistant', () => {
    const topicId = resolveValidCurrentTopicId({
      currentTopicId: 'topic-stale',
      topics: [createTopic({ id: 'topic-stale', assistantId: 'missing-assistant', updatedAt: 30 })],
      validAssistantIds: new Set(['assistant-a'])
    })

    expect(topicId).toBeNull()
  })
})
