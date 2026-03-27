import {
  assistantDatabase,
  mcpDatabase,
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
import type { MCPServer } from '@/types/mcp'
import type { Message, MessageBlock } from '@/types/message'
import type { WebSearchProvider } from '@/types/websearch'

import { assistantService } from './AssistantService'
import { getThemeModeFromBackupSettings, materializePortableImageBlocks, type ProgressUpdate } from './BackupService'
import { readBase64File } from './FileService'
import {
  buildMobileSyncAssistantPayload,
  collectPortableSyncImageAssets,
  normalizeMobileSyncExportTopics,
  type PortableSyncImageAsset
} from './mobileSyncUtils'
import { providerService } from './ProviderService'
import { topicService } from './TopicService'

const logger = loggerService.withContext('MobileSyncService')

export const MOBILE_SYNC_SCHEMA = 'cherry-studio-cross-device-sync'
export const MOBILE_SYNC_SCHEMA_VERSION = 1
export const MOBILE_SYNC_FILE_MARKER = '.mobile-sync.'

type SyncSettings = {
  userName?: string
  theme?: string
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
  mcp: {
    servers: MCPServer[]
  }
  settings: SyncSettings
  topics: SyncTopic[]
  messages: SyncMessage[]
  messageBlocks: SyncMessageBlock[]
  portableImageAssets?: PortableSyncImageAsset[]
  localStorage: Record<string, string>
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
  exportedAt: number
  data: SyncData
}

type OnProgressCallback = (update: ProgressUpdate) => void

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
  const [providers, websearchProviders, externalAssistants, topics, messages, messageBlocks, mcpServers] =
    await Promise.all([
      providerDatabase.getAllProviders(),
      websearchProviderDatabase.getAllWebSearchProviders(),
      assistantService.getExternalAssistants(),
      topicService.getTopics(),
      messageDatabase.getAllMessages(),
      messageBlockDatabase.getAllBlocks(),
      mcpDatabase.getMcps()
    ])

  let defaultAssistant: Assistant | null = null
  try {
    defaultAssistant = await assistantService.getAssistant('default')
  } catch (error) {
    logger.warn('Failed to load default assistant for mobile sync export', error)
  }

  const userName = await preferenceService.get('user.name')
  const theme = await preferenceService.get('ui.theme_mode')
  const avatar = await preferenceService.get('user.avatar')
  const searchWithTime = await preferenceService.get('websearch.search_with_time')
  const maxResults = await preferenceService.get('websearch.max_results')
  const mobileSyncAssistants = defaultAssistant ? [defaultAssistant, ...externalAssistants] : externalAssistants
  const normalizedTopics = normalizeMobileSyncExportTopics({
    assistants: mobileSyncAssistants,
    messages,
    topics
  })
  const normalizedTopicIds = new Set(normalizedTopics.map(topic => topic.id))
  const normalizedMessages = messages.filter(message => normalizedTopicIds.has(message.topicId))
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
      mcp: {
        servers: mcpServers
      },
      settings: {
        userName,
        theme,
        avatar: avatar || undefined
      },
      topics: normalizedTopics.map(toSyncTopic),
      messages: normalizedMessages.map(toSyncMessage),
      messageBlocks: normalizedMessageBlocks.map(toSyncMessageBlock),
      portableImageAssets,
      localStorage: {}
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
  await assistantDatabase.upsertAssistants(allAssistants)

  if (parsed.data.mcp.servers.length > 0) {
    await mcpDatabase.upsertMcps(parsed.data.mcp.servers)
  }

  if (parsed.data.settings.userName) {
    await preferenceService.set('user.name', parsed.data.settings.userName)
  }

  const themeMode = getThemeModeFromBackupSettings({ theme: parsed.data.settings.theme } as any)
  if (themeMode) {
    await preferenceService.set('ui.theme_mode', themeMode)
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

  await topicDatabase.upsertTopics(parsed.data.topics.map(toMobileTopic))
  await messageDatabase.upsertMessages(parsed.data.messages.map(toMobileMessage))
  await messageBlockDatabase.upsertBlocks(restoredMessageBlocks)

  topicService.invalidateCache()
  assistantService.invalidateCache()

  onProgress({ step: 'restore_messages', status: 'completed' })
}
