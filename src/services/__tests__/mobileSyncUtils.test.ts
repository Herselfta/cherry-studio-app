import { buildMobileSyncAssistantPayload } from '@/services/mobileSyncUtils'
import type { Assistant, Topic } from '@/types/assistant'

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

describe('buildMobileSyncAssistantPayload', () => {
  it('rebuilds assistant topics from the global topic table and synthesizes missing owners', () => {
    const result = buildMobileSyncAssistantPayload({
      assistants: [
        createAssistant({ id: 'default', name: 'Default', type: 'system', topics: [] }),
        createAssistant({ id: 'external-1', name: 'External One', topics: [] })
      ],
      fallbackAssistants: [
        createAssistant({ id: 'default', name: 'Seed Default', type: 'system' }),
        createAssistant({ id: 'quick', name: 'Seed Quick', type: 'system' }),
        createAssistant({ id: 'translate', name: 'Seed Translate', type: 'system' })
      ],
      topics: [
        createTopic({ id: 'default-topic', assistantId: 'default' }),
        createTopic({ id: 'external-topic', assistantId: 'external-1' }),
        createTopic({ id: 'quick-topic', assistantId: 'quick' })
      ]
    })

    expect(result.defaultAssistant.topics).toEqual([expect.objectContaining({ id: 'default-topic' })])
    expect(result.assistants.find(assistant => assistant.id === 'external-1')?.topics).toEqual([
      expect.objectContaining({ id: 'external-topic' })
    ])
    expect(result.assistants.find(assistant => assistant.id === 'quick')).toEqual(
      expect.objectContaining({
        id: 'quick',
        name: 'Seed Quick',
        topics: [expect.objectContaining({ id: 'quick-topic', assistantId: 'quick' })]
      })
    )
  })
})
