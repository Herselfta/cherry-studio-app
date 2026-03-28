import { resolveTopicScreenAssistantId } from '../topicScreenUtils'

describe('resolveTopicScreenAssistantId', () => {
  const topics = [
    { id: 'topic-a', assistantId: 'assistant-a' },
    { id: 'topic-b', assistantId: 'assistant-b' }
  ]

  it('returns undefined when the route does not scope topics to an assistant', () => {
    expect(
      resolveTopicScreenAssistantId({
        currentTopicId: 'topic-a',
        topics
      })
    ).toBeUndefined()
  })

  it('keeps the route assistant when the current topic is missing', () => {
    expect(
      resolveTopicScreenAssistantId({
        routeAssistantId: 'assistant-a',
        currentTopicId: 'missing-topic',
        topics
      })
    ).toBe('assistant-a')
  })

  it('falls back to the current topic assistant when the route assistant is stale', () => {
    expect(
      resolveTopicScreenAssistantId({
        routeAssistantId: 'assistant-a',
        currentTopicId: 'topic-b',
        topics
      })
    ).toBe('assistant-b')
  })

  it('keeps the route assistant when it still matches the current topic', () => {
    expect(
      resolveTopicScreenAssistantId({
        routeAssistantId: 'assistant-a',
        currentTopicId: 'topic-a',
        topics
      })
    ).toBe('assistant-a')
  })
})
