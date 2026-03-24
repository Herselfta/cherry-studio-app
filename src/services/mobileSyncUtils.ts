import type { Assistant, Topic } from '@/types/assistant'
import type { Message } from '@/types/message'

type BuildMobileSyncAssistantPayloadParams = {
  assistants: Assistant[]
  fallbackAssistants?: Assistant[]
  topics: Topic[]
}

type MobileSyncAssistantPayload = {
  assistants: Assistant[]
  defaultAssistant: Assistant
}

type NormalizeMobileSyncExportTopicsParams = {
  assistants: Assistant[]
  messages: Message[]
  topics: Topic[]
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) {
    merged.set(item.id, { ...merged.get(item.id), ...item })
  }
  return Array.from(merged.values())
}

function groupTopicsByAssistantId(topics: Topic[]) {
  return topics.reduce<Map<string, Topic[]>>((result, topic) => {
    const existing = result.get(topic.assistantId) || []
    result.set(topic.assistantId, mergeById(existing, [topic]))
    return result
  }, new Map())
}

function groupMessagesByTopicId(messages: Message[]) {
  return messages.reduce<Map<string, Message[]>>((result, message) => {
    const existing = result.get(message.topicId) || []
    result.set(message.topicId, [...existing, message])
    return result
  }, new Map())
}

function resolveVisibleAssistantId(
  topic: Pick<Topic, 'assistantId'> | undefined,
  messages: Message[],
  visibleAssistantIds: Set<string>
) {
  if (topic?.assistantId && visibleAssistantIds.has(topic.assistantId)) {
    return topic.assistantId
  }

  return messages.map(message => message.assistantId).find(assistantId => visibleAssistantIds.has(assistantId))
}

function synthesizeTopic(topicId: string, assistantId: string, messages: Message[]): Topic {
  const sortedMessages = [...messages].sort((left, right) => left.createdAt - right.createdAt)
  const firstMessage = sortedMessages[0]
  const lastMessage = sortedMessages.at(-1) || firstMessage

  return {
    id: topicId,
    assistantId,
    name: topicId,
    createdAt: firstMessage?.createdAt || Date.now(),
    updatedAt: lastMessage?.updatedAt || lastMessage?.createdAt || Date.now()
  }
}

function createFallbackAssistant(assistantId: string, topics: Topic[], fallbackAssistants: Assistant[]): Assistant {
  const seededAssistant = fallbackAssistants.find(assistant => assistant.id === assistantId)

  if (seededAssistant) {
    return {
      ...seededAssistant,
      topics
    }
  }

  return {
    id: assistantId,
    name: assistantId,
    prompt: '',
    topics,
    type: 'external'
  }
}

export function normalizeMobileSyncExportTopics({
  assistants,
  messages,
  topics
}: NormalizeMobileSyncExportTopicsParams): Topic[] {
  const visibleAssistantIds = new Set(assistants.map(assistant => assistant.id))
  const messagesByTopicId = groupMessagesByTopicId(messages)
  const normalizedTopics = new Map<string, Topic>()

  for (const topic of topics) {
    const topicMessages = messagesByTopicId.get(topic.id) || []
    const assistantId = resolveVisibleAssistantId(topic, topicMessages, visibleAssistantIds)

    if (!assistantId) {
      continue
    }

    normalizedTopics.set(topic.id, {
      ...topic,
      assistantId
    })
  }

  for (const [topicId, topicMessages] of messagesByTopicId.entries()) {
    if (normalizedTopics.has(topicId)) {
      continue
    }

    const assistantId = resolveVisibleAssistantId(undefined, topicMessages, visibleAssistantIds)
    if (!assistantId) {
      continue
    }

    normalizedTopics.set(topicId, synthesizeTopic(topicId, assistantId, topicMessages))
  }

  return Array.from(normalizedTopics.values())
}

export function buildMobileSyncAssistantPayload({
  assistants,
  fallbackAssistants = [],
  topics
}: BuildMobileSyncAssistantPayloadParams): MobileSyncAssistantPayload {
  // Build assistant.topic arrays from the global topic table instead of trusting the cached
  // assistant payload. Topic ownership updates can lag behind on mobile, and exporting stale
  // embedded topic arrays makes desktop imports lose whole conversations even though the
  // top-level topics/messages were exported correctly.
  const topicsByAssistantId = groupTopicsByAssistantId(topics)
  const assistantMap = new Map(assistants.map(assistant => [assistant.id, assistant]))
  const allAssistantIds = new Set<string>([...assistantMap.keys(), ...Array.from(topicsByAssistantId.keys())])

  const defaultAssistantBase =
    assistantMap.get('default') ||
    fallbackAssistants.find(assistant => assistant.id === 'default') ||
    createFallbackAssistant('default', [], fallbackAssistants)

  const defaultAssistant: Assistant = {
    ...defaultAssistantBase,
    topics: mergeById(defaultAssistantBase.topics || [], topicsByAssistantId.get('default') || [])
  }

  allAssistantIds.delete('default')

  const normalizedAssistants = Array.from(allAssistantIds).map(assistantId => {
    const baseAssistant = assistantMap.get(assistantId) || createFallbackAssistant(assistantId, [], fallbackAssistants)

    return {
      ...baseAssistant,
      topics: mergeById(baseAssistant.topics || [], topicsByAssistantId.get(assistantId) || [])
    } satisfies Assistant
  })

  return {
    defaultAssistant,
    assistants: normalizedAssistants
  }
}
