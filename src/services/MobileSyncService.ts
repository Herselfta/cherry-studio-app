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
import { ensureValidCurrentTopic } from '@/services/AppInitializationService'
import { loggerService } from '@/services/LoggerService'
import { preferenceService } from '@/services/PreferenceService'
import type { Assistant, Provider, Topic } from '@/types/assistant'
import { type Message, type MessageBlock, MessageBlockType } from '@/types/message'
import type { WebSearchProvider } from '@/types/websearch'

import { assistantService } from './AssistantService'
import { cleanupOrphanedImportedFiles, materializePortableImageBlocks, type ProgressUpdate } from './BackupService'
import { readBase64File } from './FileService'
import { getOrCreateMobileSyncSourceDeviceId } from './mobileSyncLedger'
import {
  buildMobileSyncAssistantPayload,
  collectPortableSyncImageAssets,
  normalizeMobileSyncExportTopics,
  normalizeMobileSyncImportTopics,
  normalizePortableConversationMessages,
  type PortableSyncImageAsset
} from './mobileSyncUtils'
import {
  bootstrapPortableSyncState,
  hasPortableSyncHistory,
  type PortableSyncMetadata,
  type PortableSyncVersion,
  preparePortableSyncState,
  readPortableSyncState,
  resolvePortableSyncSnapshot,
  toPortableSyncMetadata,
  writePortableSyncState
} from './portableSyncState'
import { providerService } from './ProviderService'
import { topicService } from './TopicService'

const logger = loggerService.withContext('MobileSyncService')

export const MOBILE_SYNC_SCHEMA = 'cherry-studio-cross-device-sync'
export const MOBILE_SYNC_SCHEMA_VERSION = 3
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
  sync?: PortableSyncMetadata
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

function formatPortableSyncVersion(version?: PortableSyncVersion) {
  return version ? `${version.replicaId}:${version.lamport}` : 'none'
}

function previewPortableValue(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  return value.length > 80 ? `${value.slice(0, 77)}...` : value
}

function buildPortableSyncExportSamples<T extends { id: string }>(
  items: T[],
  versionMap: Record<string, PortableSyncVersion | undefined>,
  tombstones: Record<string, PortableSyncVersion | undefined>,
  summarize: (item: T) => Record<string, unknown>,
  limit = 8
) {
  return items.slice(0, limit).map(item => ({
    id: item.id,
    version: formatPortableSyncVersion(versionMap[item.id]),
    tombstone: formatPortableSyncVersion(tombstones[item.id]),
    ...summarize(item)
  }))
}

function stringifyPortableSyncDebug(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
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
  const currentMessageIds = new Set(messages.map(message => message.id))
  const portableSyncState = preparePortableSyncState({
    topics,
    messages,
    messageBlocks: messageBlocks.filter(block => currentMessageIds.has(block.messageId))
  })
  const activeTopicIds = new Set(Object.keys(portableSyncState.entityVersions.topics))
  const mobileSyncAssistants = defaultAssistant ? [defaultAssistant, ...externalAssistants] : externalAssistants
  const normalizedTopics = normalizeMobileSyncExportTopics({
    assistants: mobileSyncAssistants,
    messages,
    topics
  }).filter(topic => activeTopicIds.has(topic.id))
  const normalizedTopicIds = new Set(normalizedTopics.map(topic => topic.id))
  const normalizedMessages = normalizePortableConversationMessages(
    messages.filter(message => normalizedTopicIds.has(message.topicId))
  )
  const normalizedMessageIds = new Set(normalizedMessages.map(message => message.id))
  const normalizedMessageBlocks = messageBlocks.filter(block => normalizedMessageIds.has(block.messageId))
  const portableImageAssets = collectPortableSyncImageAssets(normalizedMessageBlocks, readBase64File)

  logger.info('Exporting mobile sync payload', {
    version: MOBILE_SYNC_SCHEMA_VERSION,
    sourcePlatform: 'mobile',
    sourceDeviceId,
    lamport: portableSyncState.lamport,
    rawTopicCount: topics.length,
    normalizedTopicCount: normalizedTopics.length,
    rawMessageCount: messages.length,
    normalizedMessageCount: normalizedMessages.length,
    rawBlockCount: messageBlocks.length,
    normalizedBlockCount: normalizedMessageBlocks.length,
    portableImageAssetCount: portableImageAssets.length,
    topicSamples: buildPortableSyncExportSamples(
      normalizedTopics,
      portableSyncState.entityVersions.topics,
      portableSyncState.tombstones.topics,
      topic => ({
        name: topic.name,
        assistantId: topic.assistantId,
        updatedAt: topic.updatedAt
      })
    ),
    messageSamples: buildPortableSyncExportSamples(
      normalizedMessages,
      portableSyncState.entityVersions.messages,
      portableSyncState.tombstones.messages,
      message => ({
        topicId: message.topicId,
        role: message.role,
        updatedAt: message.updatedAt,
        content: previewPortableValue((message as Message & { content?: string }).content)
      })
    ),
    blockSamples: buildPortableSyncExportSamples(
      normalizedMessageBlocks,
      portableSyncState.entityVersions.blocks,
      portableSyncState.tombstones.blocks,
      block => ({
        messageId: block.messageId,
        type: block.type,
        updatedAt: block.updatedAt,
        content: previewPortableValue((block as MessageBlock & { content?: string }).content)
      })
    ),
    tombstoneTopicIds: Object.keys(portableSyncState.tombstones.topics).slice(0, 8),
    tombstoneMessageIds: Object.keys(portableSyncState.tombstones.messages).slice(0, 8),
    tombstoneBlockIds: Object.keys(portableSyncState.tombstones.blocks).slice(0, 8)
  })
  logger.info(
    `Exporting mobile sync payload summary ${stringifyPortableSyncDebug({
      version: MOBILE_SYNC_SCHEMA_VERSION,
      sourcePlatform: 'mobile',
      sourceDeviceId,
      lamport: portableSyncState.lamport,
      rawTopicCount: topics.length,
      normalizedTopicCount: normalizedTopics.length,
      rawMessageCount: messages.length,
      normalizedMessageCount: normalizedMessages.length,
      rawBlockCount: messageBlocks.length,
      normalizedBlockCount: normalizedMessageBlocks.length,
      topicSamples: buildPortableSyncExportSamples(
        normalizedTopics,
        portableSyncState.entityVersions.topics,
        portableSyncState.tombstones.topics,
        topic => ({
          name: topic.name,
          assistantId: topic.assistantId,
          updatedAt: topic.updatedAt
        })
      ),
      messageSamples: buildPortableSyncExportSamples(
        normalizedMessages,
        portableSyncState.entityVersions.messages,
        portableSyncState.tombstones.messages,
        message => ({
          topicId: message.topicId,
          role: message.role,
          updatedAt: message.updatedAt,
          content: previewPortableValue((message as Message & { content?: string }).content)
        })
      ),
      blockSamples: buildPortableSyncExportSamples(
        normalizedMessageBlocks,
        portableSyncState.entityVersions.blocks,
        portableSyncState.tombstones.blocks,
        block => ({
          messageId: block.messageId,
          type: block.type,
          updatedAt: block.updatedAt,
          content: previewPortableValue((block as MessageBlock & { content?: string }).content)
        })
      ),
      tombstoneTopicIds: Object.keys(portableSyncState.tombstones.topics).slice(0, 8),
      tombstoneMessageIds: Object.keys(portableSyncState.tombstones.messages).slice(0, 8),
      tombstoneBlockIds: Object.keys(portableSyncState.tombstones.blocks).slice(0, 8)
    })}`
  )

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
    sync: toPortableSyncMetadata(portableSyncState),
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
  let mutatedAssistantIds = allAssistants.map(assistant => assistant.id)
  const isVersionedSync = parsed.version >= 3 && Boolean(parsed.sync?.replicaId)

  logger.info('Importing mobile sync payload', {
    version: parsed.version,
    source: parsed.source,
    sourcePlatform: parsed.sourcePlatform,
    sourceDeviceId: parsed.sourceDeviceId,
    sourceAware: isVersionedSync,
    replicaId: parsed.sync?.replicaId
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

  const rawIncomingTopics = parsed.data.topics.map(toMobileTopic)
  const rawIncomingMessages = parsed.data.messages.map(toMobileMessage)
  const normalizedIncomingMessages = normalizePortableConversationMessages(rawIncomingMessages)
  const normalizedIncomingMessageIdSet = new Set(normalizedIncomingMessages.map(message => message.id))
  const rawRestoredMessageBlocks = await materializePortableImageBlocks(
    parsed.data.messageBlocks.map(toMobileMessageBlock),
    parsed.data.portableImageAssets || []
  )
  const restoredMessageBlocks = rawRestoredMessageBlocks.filter(block =>
    normalizedIncomingMessageIdSet.has(block.messageId)
  )
  const normalizedIncomingTopics = normalizeMobileSyncImportTopics({
    topLevelTopics: rawIncomingTopics,
    embeddedAssistantTopics: allAssistants.flatMap(assistant => assistant.topics || []),
    messages: normalizedIncomingMessages,
    visibleAssistantIds: new Set(allAssistants.map(assistant => assistant.id))
  })

  if (
    rawIncomingMessages.length !== normalizedIncomingMessages.length ||
    rawRestoredMessageBlocks.length !== restoredMessageBlocks.length
  ) {
    logger.info('Normalized legacy-style mobile sync snapshot before import', {
      rawIncomingMessageCount: rawIncomingMessages.length,
      normalizedIncomingMessageCount: normalizedIncomingMessages.length,
      rawIncomingBlockCount: rawRestoredMessageBlocks.length,
      normalizedIncomingBlockCount: restoredMessageBlocks.length
    })
  }

  if (!isVersionedSync) {
    await assistantDatabase.upsertAssistants(allAssistants)
    await topicDatabase.upsertTopics(normalizedIncomingTopics)
    await messageDatabase.upsertMessages(normalizedIncomingMessages)
    await messageBlockDatabase.upsertBlocks(restoredMessageBlocks)
  } else {
    const [currentTopics, currentMessages, currentMessageBlocks, currentAssistants] = await Promise.all([
      topicDatabase.getTopics(),
      messageDatabase.getAllMessages(),
      messageBlockDatabase.getAllBlocks(),
      assistantDatabase.getAllAssistants()
    ])
    const currentSnapshot = {
      topics: currentTopics,
      messages: currentMessages,
      messageBlocks: currentMessageBlocks
    }
    const existingSyncState = readPortableSyncState()
    const isBootstrapImport = !hasPortableSyncHistory(existingSyncState)
    const localSyncState = isBootstrapImport
      ? bootstrapPortableSyncState(currentSnapshot, parsed.sync!)
      : preparePortableSyncState(currentSnapshot, undefined, parsed.sync!.frontier)

    if (isBootstrapImport) {
      logger.info('Bootstrapped portable sync lineage from incoming mobile sync payload', {
        sourceDeviceId: parsed.sourceDeviceId,
        replicaId: parsed.sync?.replicaId,
        topicCount: currentTopics.length,
        messageCount: currentMessages.length,
        blockCount: currentMessageBlocks.length
      })
    }

    const resolvedConversation = resolvePortableSyncSnapshot({
      currentTopics,
      incomingTopics: normalizedIncomingTopics,
      currentMessages,
      incomingMessages: normalizedIncomingMessages,
      currentMessageBlocks,
      incomingMessageBlocks: restoredMessageBlocks,
      localState: localSyncState,
      incomingSync: parsed.sync!,
      preferIncomingOnEqualVersion: isBootstrapImport
    })
    logger.info('Resolved mobile sync conversation snapshot', {
      sourceDeviceId: parsed.sourceDeviceId,
      replicaId: parsed.sync?.replicaId,
      currentTopicCount: currentTopics.length,
      currentMessageCount: currentMessages.length,
      currentBlockCount: currentMessageBlocks.length,
      rawIncomingTopicCount: rawIncomingTopics.length,
      rawIncomingMessageCount: rawIncomingMessages.length,
      rawIncomingBlockCount: rawRestoredMessageBlocks.length,
      normalizedIncomingTopicCount: normalizedIncomingTopics.length,
      normalizedIncomingMessageCount: normalizedIncomingMessages.length,
      normalizedIncomingBlockCount: restoredMessageBlocks.length,
      resolvedTopicCount: resolvedConversation.topics.length,
      resolvedMessageCount: resolvedConversation.messages.length,
      resolvedBlockCount: resolvedConversation.messageBlocks.length,
      deletedTopicCount: resolvedConversation.deletedTopicIds.length,
      deletedMessageCount: resolvedConversation.deletedMessageIds.length,
      deletedBlockCount: resolvedConversation.deletedBlockIds.length
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
    mutatedAssistantIds = resolvedAssistants.map(assistant => assistant.id)
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
    writePortableSyncState(resolvedConversation.syncState)

    if (resolvedConversation.deletedTopicIds.length > 0) {
      logger.info(`Deleted ${resolvedConversation.deletedTopicIds.length} topic(s) from versioned mobile sync`)
    }
    if (resolvedConversation.deletedMessageIds.length > 0) {
      logger.info(`Deleted ${resolvedConversation.deletedMessageIds.length} message(s) from versioned mobile sync`)
    }
    if (resolvedConversation.deletedBlockIds.length > 0) {
      logger.info(`Deleted ${resolvedConversation.deletedBlockIds.length} block(s) from versioned mobile sync`)
    }
  }

  await ensureValidCurrentTopic()
  topicService.invalidateCache()
  assistantService.syncAfterExternalMutation(mutatedAssistantIds)

  onProgress({ step: 'restore_messages', status: 'completed' })
}
