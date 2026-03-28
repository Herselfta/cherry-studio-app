import type { Topic } from '@/types/assistant'

type TopicIdentity = Pick<Topic, 'assistantId' | 'id'>

export function resolveTopicScreenAssistantId(params: {
  currentTopicId?: string
  routeAssistantId?: string
  topics: TopicIdentity[]
}): string | undefined {
  const { currentTopicId, routeAssistantId, topics } = params

  if (!routeAssistantId) {
    return undefined
  }

  if (!currentTopicId) {
    return routeAssistantId
  }

  const currentTopic = topics.find(topic => topic.id === currentTopicId)
  if (!currentTopic) {
    return routeAssistantId
  }

  if (currentTopic.assistantId !== routeAssistantId) {
    return currentTopic.assistantId
  }

  return routeAssistantId
}
