import { assistantDatabase, messageBlockDatabase, messageDatabase, topicDatabase } from '@database'

import { getSystemAssistants } from '@/config/assistants'
import { ensureValidCurrentTopic } from '@/services/AppInitializationService'
import {
  type MobileOnlineSyncConfig,
  readMobileOnlineSyncConfig,
  readMobileOnlineSyncState,
  writeMobileOnlineSyncState
} from '@/services/MobileOnlineSyncStorage'
import { preferenceService } from '@/services/PreferenceService'
import type { Assistant, Topic } from '@/types/assistant'
import type { Message, MessageBlock } from '@/types/message'

import { assistantService } from './AssistantService'
import {
  applyMobileOnlineSyncChanges,
  buildMobileOnlineSyncChanges,
  markMobileOnlineSyncChangesPublished,
  MOBILE_ONLINE_SYNC_PROFILE_ID,
  type MobileOnlineSyncAssistant,
  type MobileOnlineSyncChange,
  type MobileOnlineSyncMessage,
  type MobileOnlineSyncMessageBlock,
  type MobileOnlineSyncSnapshot,
  type MobileOnlineSyncTopic,
  prepareMobileOnlineSyncState
} from './mobileOnlineSyncProtocol'
import { buildMobileSyncAssistantPayload } from './mobileSyncUtils'
import { topicService } from './TopicService'

import { syncLogger as logger } from './MobileOnlineSyncLogger'
type FetchRequestInit = Parameters<typeof fetch>[1]

type PullResponse = {
  cursor: number
  changes: MobileOnlineSyncChange[]
}

type PushResponse = {
  cursor: number
  acceptedChanges: MobileOnlineSyncChange[]
  skippedChanges: { reason: string }[]
}

function resolveAssistantType(
  assistant: MobileOnlineSyncAssistant,
  systemAssistantIds: Set<string>
): Assistant['type'] {
  if (assistant.type === 'built_in') {
    return 'built_in'
  }

  return systemAssistantIds.has(assistant.id) ? 'system' : 'external'
}

function sanitizeAssistantForOnlineSync(assistant: Assistant): MobileOnlineSyncAssistant {
  return {
    id: assistant.id,
    name: assistant.name,
    prompt: assistant.prompt,
    type: assistant.type,
    emoji: assistant.emoji,
    avatar: assistant.avatar,
    description: assistant.description,
    model: assistant.model,
    defaultModel: assistant.defaultModel,
    settings: assistant.settings,
    enableUrlContext: assistant.enableUrlContext,
    enableWebSearch: assistant.enableWebSearch,
    webSearchProviderId: assistant.webSearchProviderId,
    enableGenerateImage: assistant.enableGenerateImage,
    knowledgeRecognition: assistant.knowledgeRecognition,
    tags: assistant.tags,
    group: assistant.group,
    mcpServers: assistant.mcpServers,
    topics: []
  }
}

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return value
  }

  return value ? new Date(value).getTime() : 0
}

function toSyncTopic(topic: Topic): MobileOnlineSyncTopic {
  return {
    ...topic,
    createdAt: toTimestamp(topic.createdAt),
    updatedAt: toTimestamp(topic.updatedAt)
  }
}

function toSyncMessage(message: Message): MobileOnlineSyncMessage {
  return {
    ...message,
    createdAt: toTimestamp(message.createdAt),
    updatedAt: message.updatedAt ? toTimestamp(message.updatedAt) : undefined
  }
}

function toSyncMessageBlock(block: MessageBlock): MobileOnlineSyncMessageBlock {
  return {
    ...block,
    createdAt: toTimestamp(block.createdAt),
    updatedAt: block.updatedAt ? toTimestamp(block.updatedAt) : undefined
  } as MobileOnlineSyncMessageBlock
}

function toMobileTopic(topic: MobileOnlineSyncTopic): Topic {
  return {
    ...topic,
    createdAt: toTimestamp(topic.createdAt),
    updatedAt: toTimestamp(topic.updatedAt)
  }
}

function toMobileMessage(message: MobileOnlineSyncMessage): Message {
  return {
    ...message,
    createdAt: toTimestamp(message.createdAt),
    updatedAt: message.updatedAt ? toTimestamp(message.updatedAt) : undefined
  } as Message
}

function toMobileMessageBlock(block: MobileOnlineSyncMessageBlock): MessageBlock {
  return {
    ...block,
    createdAt: toTimestamp(block.createdAt),
    updatedAt: block.updatedAt ? toTimestamp(block.updatedAt) : undefined
  } as MessageBlock
}

async function collectSnapshot(): Promise<MobileOnlineSyncSnapshot> {
  const [assistants, topics, messages, messageBlocks, userName, avatar] = await Promise.all([
    assistantDatabase.getAllAssistants(),
    topicDatabase.getTopics(),
    messageDatabase.getAllMessages(),
    messageBlockDatabase.getAllBlocks(),
    preferenceService.get('user.name'),
    preferenceService.get('user.avatar')
  ])
  const messageIds = new Set(messages.map(message => message.id))

  const snapshot: MobileOnlineSyncSnapshot = {
    profile: {
      id: MOBILE_ONLINE_SYNC_PROFILE_ID,
      userName: userName || undefined,
      avatar: avatar || undefined
    },
    assistants: assistants.map(sanitizeAssistantForOnlineSync),
    topics: topics.map(toSyncTopic),
    messages: messages.map(toSyncMessage),
    messageBlocks: messageBlocks.filter(block => messageIds.has(block.messageId)).map(toSyncMessageBlock)
  }

  logger.info('Collected mobile online sync snapshot', {
    assistantCount: snapshot.assistants.length,
    topicCount: snapshot.topics.length,
    messageCount: snapshot.messages.length,
    blockCount: snapshot.messageBlocks.length
  })

  return snapshot
}

async function applySnapshot(snapshot: MobileOnlineSyncSnapshot) {
  const [currentTopics, currentMessages, currentBlocks, currentAssistants] = await Promise.all([
    topicDatabase.getTopics(),
    messageDatabase.getAllMessages(),
    messageBlockDatabase.getAllBlocks(),
    assistantDatabase.getAllAssistants()
  ])
  const incomingTopics = snapshot.topics.map(toMobileTopic)
  const incomingMessages = snapshot.messages.map(toMobileMessage)
  const incomingBlocks = snapshot.messageBlocks.map(toMobileMessageBlock)
  const incomingAssistants = snapshot.assistants.map(assistant => ({
    ...assistant,
    topics: []
  })) as unknown as Assistant[]
  const systemAssistantIds = new Set(getSystemAssistants().map(assistant => assistant.id))
  const resolvedAssistantPayload = buildMobileSyncAssistantPayload({
    assistants: [...currentAssistants, ...incomingAssistants],
    fallbackAssistants: [...currentAssistants, ...getSystemAssistants()],
    topics: incomingTopics
  })
  const resolvedAssistants: Assistant[] = [
    {
      ...resolvedAssistantPayload.defaultAssistant,
      type: 'system'
    },
    ...resolvedAssistantPayload.assistants.map(assistant => ({
      ...assistant,
      type: resolveAssistantType(assistant as MobileOnlineSyncAssistant, systemAssistantIds)
    }))
  ]
  const targetTopicIds = new Set(incomingTopics.map(topic => topic.id))
  const targetMessageIds = new Set(incomingMessages.map(message => message.id))
  const targetBlockIds = new Set(incomingBlocks.map(block => block.id))

  await assistantDatabase.upsertAssistants(resolvedAssistants)

  for (const topicId of currentTopics.filter(topic => !targetTopicIds.has(topic.id)).map(topic => topic.id)) {
    await topicDatabase.deleteTopicById(topicId)
  }

  for (const messageId of currentMessages
    .filter(message => !targetMessageIds.has(message.id))
    .map(message => message.id)) {
    await messageDatabase.deleteMessageById(messageId)
  }

  const deletedBlockIds = currentBlocks.filter(block => !targetBlockIds.has(block.id)).map(block => block.id)
  if (deletedBlockIds.length > 0) {
    await messageBlockDatabase.removeManyBlocks(deletedBlockIds)
  }

  await topicDatabase.upsertTopics(incomingTopics)
  await messageDatabase.upsertMessages(incomingMessages)
  await messageBlockDatabase.upsertBlocks(incomingBlocks)

  if (typeof snapshot.profile.userName === 'string') {
    await preferenceService.set('user.name', snapshot.profile.userName)
  }

  if (typeof snapshot.profile.avatar === 'string') {
    await preferenceService.set('user.avatar', snapshot.profile.avatar)
  }

  topicService.invalidateCache()
  assistantService.syncAfterExternalMutation(resolvedAssistants.map(assistant => assistant.id))
  await ensureValidCurrentTopic()

  logger.info('Applied mobile online sync snapshot', {
    assistantCount: resolvedAssistants.length,
    topicCount: incomingTopics.length,
    messageCount: incomingMessages.length,
    blockCount: incomingBlocks.length
  })
}

async function requestJson<T>(config: MobileOnlineSyncConfig, path: string, init?: FetchRequestInit): Promise<T> {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.authToken}`,
      ...(init?.headers || {})
    }
  })

  if (!response.ok) {
    throw new Error(`Mobile online sync request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export async function syncMobileOnline(config?: MobileOnlineSyncConfig) {
  const effectiveConfig = config || readMobileOnlineSyncConfig()
  if (!effectiveConfig) {
    throw new Error('Mobile online sync config is missing')
  }

  const snapshot = await collectSnapshot()
  let trackerState = readMobileOnlineSyncState()
  const prepared = prepareMobileOnlineSyncState(snapshot, trackerState)
  trackerState = prepared.state
  writeMobileOnlineSyncState(trackerState)

  const outgoingChanges = buildMobileOnlineSyncChanges(prepared.snapshot, trackerState)

  logger.info('Prepared mobile online sync delta', {
    outgoingChangeCount: outgoingChanges.length,
    topicCount: prepared.snapshot.topics.length,
    messageCount: prepared.snapshot.messages.length,
    blockCount: prepared.snapshot.messageBlocks.length,
    cursor: trackerState.lastPulledCursor
  })

  if (outgoingChanges.length > 0) {
    const pushResponse = await requestJson<PushResponse>(effectiveConfig, '/v1/mobile-sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes: outgoingChanges })
    })

    trackerState = markMobileOnlineSyncChangesPublished(trackerState, pushResponse.acceptedChanges)

    logger.info('Completed mobile online sync push', {
      pushedChangeCount: outgoingChanges.length,
      acceptedChangeCount: pushResponse.acceptedChanges.length,
      skippedChangeCount: pushResponse.skippedChanges.length,
      cursorAfterPush: pushResponse.cursor
    })
  }

  const pullResponse = await requestJson<PullResponse>(
    effectiveConfig,
    `/v1/mobile-sync/pull?cursor=${trackerState.lastPulledCursor}`
  )
  const applyResult = applyMobileOnlineSyncChanges(prepared.snapshot, trackerState, pullResponse.changes)
  applyResult.state.lastPulledCursor = pullResponse.cursor

  logger.info('Completed mobile online sync pull', {
    incomingChangeCount: pullResponse.changes.length,
    acceptedChangeCount: applyResult.acceptedChanges.length,
    skippedChangeCount: applyResult.skippedChanges.length,
    cursorAfterPull: pullResponse.cursor
  })

  if (applyResult.acceptedChanges.length > 0) {
    await applySnapshot(applyResult.snapshot)
  }

  writeMobileOnlineSyncState(applyResult.state)

  return {
    pushedChangeCount: outgoingChanges.length,
    appliedIncomingChangeCount: applyResult.acceptedChanges.length,
    skippedIncomingChangeCount: applyResult.skippedChanges.length,
    cursor: pullResponse.cursor
  }
}
