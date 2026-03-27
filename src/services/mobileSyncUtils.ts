import type { Assistant, Topic } from '@/types/assistant'
import { FileTypes, type FileMetadata } from '@/types/file'
import { MessageBlockType, type Message, type MessageBlock } from '@/types/message'

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

export type PortableSyncImageAsset = {
  fileId: string
  data: string
  ext?: string
  name?: string
  origin_name?: string
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

function getPortableImageMimeSubtype(file: Pick<FileMetadata, 'ext'>) {
  const normalizedExt = file.ext.replace(/^\./, '').toLowerCase()

  if (normalizedExt === 'jpg') {
    return 'jpeg'
  }

  if (normalizedExt === 'svg') {
    return 'svg+xml'
  }

  return normalizedExt || 'png'
}

export function collectPortableSyncImageAssets(
  messageBlocks: MessageBlock[],
  readImageBase64: (file: FileMetadata) => string
): PortableSyncImageAsset[] {
  const seenFileIds = new Set<string>()
  const portableImageAssets: PortableSyncImageAsset[] = []

  for (const block of messageBlocks) {
    if (block.type !== MessageBlockType.IMAGE || !block.file || block.file.type !== FileTypes.IMAGE) {
      continue
    }

    if (seenFileIds.has(block.file.id)) {
      continue
    }

    seenFileIds.add(block.file.id)
    const base64 = readImageBase64(block.file)
    const mimeSubtype = getPortableImageMimeSubtype(block.file)

    portableImageAssets.push({
      fileId: block.file.id,
      data: `data:image/${mimeSubtype};base64,${base64}`,
      ext: block.file.ext,
      name: block.file.name,
      origin_name: block.file.origin_name
    })
  }

  return portableImageAssets
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
