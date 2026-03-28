import type { Topic } from '@/types/assistant'

function getTopicTimestamp(topic: Topic): number {
  return topic.updatedAt ?? topic.createdAt
}

export function resolveValidCurrentTopicId(params: {
  currentTopicId: string
  topics: Topic[]
  validAssistantIds: Set<string>
}): string | null {
  const { currentTopicId, topics, validAssistantIds } = params
  const topicsById = new Map(topics.map(topic => [topic.id, topic]))
  const currentTopic = currentTopicId ? topicsById.get(currentTopicId) : undefined

  if (currentTopic && validAssistantIds.has(currentTopic.assistantId)) {
    return currentTopic.id
  }

  const fallbackTopic = [...topics]
    .filter(topic => validAssistantIds.has(topic.assistantId))
    .sort((left, right) => getTopicTimestamp(right) - getTopicTimestamp(left))[0]

  return fallbackTopic?.id ?? null
}
