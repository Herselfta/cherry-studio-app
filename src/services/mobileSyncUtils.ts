import type { Assistant, Topic } from '@/types/assistant'

type BuildMobileSyncAssistantPayloadParams = {
  assistants: Assistant[]
  fallbackAssistants?: Assistant[]
  topics: Topic[]
}

type MobileSyncAssistantPayload = {
  assistants: Assistant[]
  defaultAssistant: Assistant
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
