import {
  assistantDatabase,
  messageBlockDatabase,
  messageDatabase,
  providerDatabase,
  topicDatabase,
  websearchProviderDatabase
} from '@database'
import type { Dispatch } from '@reduxjs/toolkit'

import { getSystemAssistants } from '@/config/assistants'
import { loggerService } from '@/services/LoggerService'
import { preferenceService } from '@/services/PreferenceService'
import type { Assistant, Provider, Topic } from '@/types/assistant'
import { type Message, type MessageBlock, MessageBlockType } from '@/types/message'
import type { WebSearchProvider } from '@/types/websearch'

import { assistantService } from './AssistantService'
import { cleanupOrphanedImportedFiles, materializePortableImageBlocks, type ProgressUpdate } from './BackupService'
import { readBase64File } from './FileService'
import {
  getMobileSyncLedgerEntry,
  getOrCreateMobileSyncSourceDeviceId,
  writeMobileSyncLedgerEntry
} from './mobileSyncLedger'
import {
  buildMobileSyncAssistantPayload,
  collectPortableSyncImageAssets,
  normalizeMobileSyncExportTopics,
  normalizePortableConversationMessages,
  type PortableSyncImageAsset,
  resolveMobileConversationSync
} from './mobileSyncUtils'
import { providerService } from './ProviderService'
import { topicService } from './TopicService'

const logger = loggerService.withContext('MobileSyncService')

export const MOBILE_SYNC_SCHEMA = 'cherry-studio-cross-device-sync'
export const MOBILE_SYNC_SCHEMA_VERSION = 2
export const MOBILE_SYNC_FILE_MARKER = '.mobile-sync.'

type SyncSettings = {
  userName?: string
  avatar?: string
}

type SyncData = {
  assistants: {
    defaultAssistant: Assistant
    assistants: Assistant[]
  }
  llm: {
    providers: Provider[]
  }
  websearch: {
    providers: WebSearchProvider[]
    searchWithTime?: boolean
    maxResults?: number
  }
  settings: SyncSettings
  topics: SyncTopic[]
  messages: SyncMessage[]
  messageBlocks: SyncMessageBlock[]
  portableImageAssets?: PortableSyncImageAsset[]
}

type SyncTopic = Omit<Topic, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt: number
}

type SyncMessage = Omit<Message, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt?: number
}

type SyncMessageBlock = Omit<MessageBlock, 'createdAt' | 'updatedAt'> & {
  createdAt: number
  updatedAt?: number
}

type MobileSyncPayload = {
  schema: typeof MOBILE_SYNC_SCHEMA
  version: number
  source: 'desktop' | 'mobile'
  sourceDeviceId?: string
  sourcePlatform?: 'desktop' | 'mobile'
  exportedAt: number
  data: SyncData
}

type OnProgressCallback = (update: ProgressUpdate) => void

function resolvePortableAssistantType(assistant: Assistant, systemAssistantIds: Set<string>): Assistant['type'] {
  if (assistant.type === 'built_in') {
    return 'built_in'
  }

  return systemAssistantIds.has(assistant.id) ? 'system' : 'external'
}

export function buildPortableSyncSettings(settings: { userName?: string }, avatar?: string | null): SyncSettings {
  return {
    userName: settings.userName,
    avatar: avatar || undefined
  }
}

function sanitizeAssistantForSync(assistant: Assistant): Assistant {
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
    enableWebSearch: assistant.enableWebSearch,
    enableGenerateImage: assistant.enableGenerateImage,
    webSearchProviderId: assistant.webSearchProviderId,
    mcpServers: assistant.mcpServers,
    knowledgeRecognition: assistant.knowledgeRecognition,
    tags: assistant.tags,
    group: assistant.group,
    topics: assistant.topics.map(toSyncTopic) as unknown as Topic[]
  }
}

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return value
  }

  return value ? new Date(value).getTime() : Date.now()
}

function toMobileTopic(topic: SyncTopic): Topic {
  return {
    ...topic,
    createdAt: toTimestamp(topic.createdAt),
    updatedAt: toTimestamp(topic.updatedAt)
  }
}

function toMobileMessage(message: SyncMessage): Message {
  return {
    ...message,
    createdAt: toTimestamp(message.createdAt),
    updatedAt: message.updatedAt ? toTimestamp(message.updatedAt) : undefined
  }
}

function toMobileMessageBlock(block: SyncMessageBlock): MessageBlock {
  return {
    ...block,
    createdAt: toTimestamp(block.createdAt),
    updatedAt: block.updatedAt ? toTimestamp(block.updatedAt) : undefined
  } as MessageBlock
}

function getBlockFileId(block: MessageBlock) {
  if (block.type !== MessageBlockType.IMAGE && block.type !== MessageBlockType.FILE) {
    return undefined
  }

  return block.file?.id
}

function toSyncTopic(topic: Topic): SyncTopic {
  return {
    ...topic,
    createdAt: toTimestamp(topic.createdAt),
    updatedAt: toTimestamp(topic.updatedAt)
  }
}

function toSyncMessage(message: Message): SyncMessage {
  return {
    ...message,
    createdAt: toTimestamp(message.createdAt),
    updatedAt: message.updatedAt ? toTimestamp(message.updatedAt) : undefined
  }
}

function toSyncMessageBlock(block: MessageBlock): SyncMessageBlock {
  return {
    ...block,
    createdAt: toTimestamp(block.createdAt),
    updatedAt: block.updatedAt ? toTimestamp(block.updatedAt) : undefined
  }
}

function isMobileSyncPayloadObject(payload: unknown): payload is MobileSyncPayload {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    (payload as MobileSyncPayload).schema === MOBILE_SYNC_SCHEMA &&
    typeof (payload as MobileSyncPayload).version === 'number'
  )
}

export function isMobileSyncPayload(payload: string): boolean {
  try {
    return isMobileSyncPayloadObject(JSON.parse(payload))
  } catch (error) {
    logger.warn('Failed to inspect mobile sync payload', error)
    return false
  }
}

export function isMobileSyncRemoteFile(fileName: string): boolean {
  return fileName.includes(MOBILE_SYNC_FILE_MARKER) && fileName.endsWith('.json')
}

export async function exportMobileSyncPayload(): Promise<string> {
  const [providers, websearchProviders, externalAssistants, topics, messages, messageBlocks] = await Promise.all([
    providerDatabase.getAllProviders(),
    websearchProviderDatabase.getAllWebSearchProviders(),
    assistantService.getExternalAssistants(),
    topicService.getTopics(),
    messageDatabase.getAllMessages(),
    messageBlockDatabase.getAllBlocks()
  ])

  let defaultAssistant: Assistant | null = null
  try {
    defaultAssistant = await assistantService.getAssistant('default')
  } catch (error) {
    logger.warn('Failed to load default assistant for mobile sync export', error)
  }

  const userName = await preferenceService.get('user.name')
  const avatar = await preferenceService.get('user.avatar')
  const searchWithTime = await preferenceService.get('websearch.search_with_time')
  const maxResults = await preferenceService.get('websearch.max_results')
  const sourceDeviceId = getOrCreateMobileSyncSourceDeviceId()
  const mobileSyncAssistants = defaultAssistant ? [defaultAssistant, ...externalAssistants] : externalAssistants
  const normalizedTopics = normalizeMobileSyncExportTopics({
    assistants: mobileSyncAssistants,
    messages,
    topics
  })
  const normalizedTopicIds = new Set(normalizedTopics.map(topic => topic.id))
  const normalizedMessages = normalizePortableConversationMessages(
    messages.filter(message => normalizedTopicIds.has(message.topicId))
  )
  const normalizedMessageIds = new Set(normalizedMessages.map(message => message.id))
  const normalizedMessageBlocks = messageBlocks.filter(block => normalizedMessageIds.has(block.messageId))
  const portableImageAssets = collectPortableSyncImageAssets(normalizedMessageBlocks, readBase64File)

  const { defaultAssistant: syncDefaultAssistant, assistants: syncAssistants } = buildMobileSyncAssistantPayload({
    assistants: mobileSyncAssistants,
    fallbackAssistants: defaultAssistant ? [defaultAssistant] : [getSystemAssistants()[0]],
    topics: normalizedTopics
  })

  const payload: MobileSyncPayload = {
    schema: MOBILE_SYNC_SCHEMA,
    version: MOBILE_SYNC_SCHEMA_VERSION,
    source: 'mobile',
    sourceDeviceId,
    sourcePlatform: 'mobile',
    exportedAt: Date.now(),
    data: {
      assistants: {
        defaultAssistant: sanitizeAssistantForSync(syncDefaultAssistant),
        assistants: syncAssistants.map(sanitizeAssistantForSync)
      },
      llm: {
        providers
      },
      websearch: {
        providers: websearchProviders,
        searchWithTime,
        maxResults
      },
      settings: {
        ...buildPortableSyncSettings({ userName }, avatar)
      },
      topics: normalizedTopics.map(toSyncTopic),
      messages: normalizedMessages.map(toSyncMessage),
      messageBlocks: normalizedMessageBlocks.map(toSyncMessageBlock),
      portableImageAssets
    }
  }

  // Cross-device sync only carries the subset that both apps understand.
  // Keep it separate from full backup/restore so importing phone data on desktop
  // cannot wipe desktop-only state during future upstream backup refactors.
  return JSON.stringify(payload)
}

export async function importMobileSyncPayload(payload: string, onProgress: OnProgressCallback, _dispatch: Dispatch) {
  const parsed = JSON.parse(payload) as unknown
  if (!isMobileSyncPayloadObject(parsed)) {
    throw new Error('Invalid mobile sync payload')
  }

  if (parsed.version > MOBILE_SYNC_SCHEMA_VERSION) {
    throw new Error(`Unsupported mobile sync schema version: ${parsed.version}`)
  }

  onProgress({ step: 'restore_settings', status: 'in_progress' })
  await providerDatabase.upsertProviders(parsed.data.llm.providers)
  providerService.invalidateCache()
  await providerService.refreshAllProvidersCache()
  await websearchProviderDatabase.upsertWebSearchProviders(parsed.data.websearch.providers)

  const allAssistants = [parsed.data.assistants.defaultAssistant, ...parsed.data.assistants.assistants].map(
    (assistant, index) =>
      ({
        ...assistant,
        topics: (assistant.topics || []).map(topic => toMobileTopic(topic as unknown as SyncTopic)),
        type: index === 0 ? 'system' : 'external'
      }) as Assistant
  )
  const shouldUseSourceAwareImport = parsed.version >= 2 && Boolean(parsed.sourceDeviceId)
  const previousLedgerEntry = shouldUseSourceAwareImport ? getMobileSyncLedgerEntry(parsed.sourceDeviceId!) : undefined

  logger.info('Importing mobile sync payload', {
    version: parsed.version,
    source: parsed.source,
    sourcePlatform: parsed.sourcePlatform,
    sourceDeviceId: parsed.sourceDeviceId,
    sourceAware: shouldUseSourceAwareImport,
    hasPreviousLedgerEntry: Boolean(previousLedgerEntry)
  })

  if (parsed.data.settings.userName) {
    await preferenceService.set('user.name', parsed.data.settings.userName)
  }

  if (parsed.data.settings.avatar) {
    await preferenceService.set('user.avatar', parsed.data.settings.avatar)
  }

  if (typeof parsed.data.websearch.searchWithTime === 'boolean') {
    await preferenceService.set('websearch.search_with_time', parsed.data.websearch.searchWithTime)
  }

  if (typeof parsed.data.websearch.maxResults === 'number') {
    await preferenceService.set('websearch.max_results', parsed.data.websearch.maxResults)
  }

  onProgress({ step: 'restore_settings', status: 'completed' })
  onProgress({ step: 'restore_messages', status: 'in_progress' })

  const restoredMessageBlocks = await materializePortableImageBlocks(
    parsed.data.messageBlocks.map(toMobileMessageBlock),
    parsed.data.portableImageAssets || []
  )

  if (!shouldUseSourceAwareImport) {
    await assistantDatabase.upsertAssistants(allAssistants)
    await topicDatabase.upsertTopics(parsed.data.topics.map(toMobileTopic))
    await messageDatabase.upsertMessages(parsed.data.messages.map(toMobileMessage))
    await messageBlockDatabase.upsertBlocks(restoredMessageBlocks)
  } else {
    const [currentTopics, currentMessages, currentMessageBlocks, currentAssistants] = await Promise.all([
      topicDatabase.getTopics(),
      messageDatabase.getAllMessages(),
      messageBlockDatabase.getAllBlocks(),
      assistantDatabase.getAllAssistants()
    ])
    const resolvedConversation = resolveMobileConversationSync({
      currentTopics,
      incomingTopics: parsed.data.topics.map(toMobileTopic),
      currentMessages,
      incomingMessages: parsed.data.messages.map(toMobileMessage),
      currentMessageBlocks,
      incomingMessageBlocks: restoredMessageBlocks,
      exportedAt: parsed.exportedAt,
      previousLedgerEntry
    })
    const systemAssistantIds = new Set(getSystemAssistants().map(assistant => assistant.id))
    const resolvedAssistantPayload = buildMobileSyncAssistantPayload({
      assistants: [...currentAssistants, ...allAssistants],
      fallbackAssistants: [...currentAssistants, ...getSystemAssistants()],
      topics: resolvedConversation.topics
    })
    const resolvedAssistants: Assistant[] = [
      {
        ...resolvedAssistantPayload.defaultAssistant,
        type: 'system'
      },
      ...resolvedAssistantPayload.assistants.map(assistant => ({
        ...assistant,
        type: resolvePortableAssistantType(assistant, systemAssistantIds)
      }))
    ]
    const incomingBlockIdSet = new Set(restoredMessageBlocks.map(block => block.id))
    const deletedBlockIdSet = new Set(resolvedConversation.deletedBlockIds)
    const candidateFileIds = new Set<string>([
      ...currentMessageBlocks
        .map(block => ({ id: block.id, fileId: getBlockFileId(block) }))
        .filter(block => block.fileId && (deletedBlockIdSet.has(block.id) || incomingBlockIdSet.has(block.id)))
        .map(block => block.fileId!),
      ...restoredMessageBlocks.map(getBlockFileId).filter((fileId): fileId is string => Boolean(fileId))
    ])

    await assistantDatabase.upsertAssistants(resolvedAssistants)
    for (const topicId of resolvedConversation.deletedTopicIds) {
      await topicDatabase.deleteTopicById(topicId)
    }
    for (const messageId of resolvedConversation.deletedMessageIds) {
      await messageDatabase.deleteMessageById(messageId)
    }
    if (resolvedConversation.deletedBlockIds.length > 0) {
      await messageBlockDatabase.removeManyBlocks(resolvedConversation.deletedBlockIds)
    }

    await topicDatabase.upsertTopics(resolvedConversation.topics)
    await messageDatabase.upsertMessages(resolvedConversation.messages)
    await messageBlockDatabase.upsertBlocks(resolvedConversation.messageBlocks)
    await cleanupOrphanedImportedFiles(candidateFileIds, resolvedConversation.messageBlocks)

    if (!resolvedConversation.isStaleImport && resolvedConversation.nextLedgerEntry) {
      writeMobileSyncLedgerEntry(parsed.sourceDeviceId!, resolvedConversation.nextLedgerEntry)
    } else if (resolvedConversation.isStaleImport) {
      logger.warn(
        `Skipping destructive mobile sync actions for stale payload from ${parsed.sourceDeviceId} exported at ${parsed.exportedAt}`
      )
    }
  }

  topicService.invalidateCache()
  assistantService.invalidateCache()

  onProgress({ step: 'restore_messages', status: 'completed' })
}
