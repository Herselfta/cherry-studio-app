import {
  assistantDatabase,
  fileDatabase,
  mcpDatabase,
  messageBlockDatabase,
  messageDatabase,
  providerDatabase,
  topicDatabase,
  websearchProviderDatabase
} from '@database'
import type { Dispatch } from '@reduxjs/toolkit'
import dayjs from 'dayjs'
import { Directory, File, Paths } from 'expo-file-system'
import { unzip, zip } from 'react-native-zip-archive'

import { getSystemAssistants } from '@/config/assistants'
import { normalizeLanguageTag } from '@/config/languages'
import { DEFAULT_BACKUP_STORAGE, DEFAULT_DOCUMENTS_STORAGE } from '@/constants/storage'
import i18n from '@/i18n'
import { loggerService } from '@/services/LoggerService'
import { preferenceService } from '@/services/PreferenceService'
import type { LanguageVarious } from '@/types'
import { ThemeMode } from '@/types'
import type { Assistant, Topic } from '@/types/assistant'
import type {
  ExportIndexedData,
  ExportReduxData,
  ImportIndexedData,
  ImportReduxData,
  PortableImageAsset,
  Setting
} from '@/types/databackup'
import type { FileMetadata } from '@/types/file'
import { type ImageMessageBlock, type Message, MessageBlockType } from '@/types/message'
import { storage } from '@/utils'

import { resetAppInitializationState, runAppDataMigrations } from './AppInitializationService'
import { assistantService } from './AssistantService'
import { deleteFiles, writeBase64File } from './FileService'
import { type PortableSyncMetadata,seedPortableSyncState } from './portableSyncState'
import { providerService } from './ProviderService'
import { topicService } from './TopicService'
import {
  getStoredWebDavConfig,
  getWebDavBackupSettings,
  getWebDavConfigFromBackup,
  saveStoredWebDavConfig,
  WEBDAV_CONFIG_STORAGE_KEY,
  type WebDavConfig
} from './WebDavConfigService'
const logger = loggerService.withContext('Backup Service')
const SYSTEM_ASSISTANT_IDS = ['default', 'quick', 'translate'] as const
const NON_PORTABLE_DESKTOP_SETTINGS_KEYS = [
  'localBackupDir',
  'localBackupAutoSync',
  'localBackupSyncInterval',
  'localBackupMaxBackups',
  'localBackupSkipBackupFile'
] as const

type SystemAssistantId = (typeof SYSTEM_ASSISTANT_IDS)[number]

function isSystemAssistantId(assistantId: string): assistantId is SystemAssistantId {
  return SYSTEM_ASSISTANT_IDS.includes(assistantId as SystemAssistantId)
}

type NormalizedBackupAssistants = {
  systemAssistants: Assistant[]
  externalAssistants: Assistant[]
  globalDefaultModel?: Assistant['defaultModel']
  source: 'app-native' | 'desktop-migration'
}

type BackupLlmState = ImportReduxData['llm']

function mergeAssistantsById(assistants: Assistant[]): Assistant[] {
  const assistantMap = new Map<string, Assistant>()

  for (const assistant of assistants) {
    const previousAssistant = assistantMap.get(assistant.id)

    if (!previousAssistant) {
      assistantMap.set(assistant.id, assistant)
      continue
    }

    assistantMap.set(assistant.id, {
      ...previousAssistant,
      ...assistant,
      avatar: assistant.avatar ?? previousAssistant.avatar,
      emoji: assistant.emoji ?? previousAssistant.emoji,
      topics: (assistant.topics?.length ? assistant.topics : previousAssistant.topics) ?? []
    })
  }

  return [...assistantMap.values()]
}

function sanitizePortableBackupSettings<T extends Record<string, unknown>>(settings: T): T {
  const sanitizedSettings = { ...settings }

  // Desktop migration payloads can still carry machine-local backup settings
  // inside persisted Redux. They do not make sense on mobile restore targets
  // and would incorrectly leak a desktop-only local backup feature across devices.
  for (const key of NON_PORTABLE_DESKTOP_SETTINGS_KEYS) {
    delete sanitizedSettings[key]
  }

  return sanitizedSettings
}

function isPortableImageAsset(value: unknown): value is PortableImageAsset {
  return !!value && typeof value === 'object' && 'fileId' in value && 'data' in value
}

function isPortableSyncMetadata(value: unknown): value is PortableSyncMetadata {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PortableSyncMetadata).replicaId === 'string' &&
      typeof (value as PortableSyncMetadata).lamport === 'number' &&
      (value as PortableSyncMetadata).frontier &&
      typeof (value as PortableSyncMetadata).frontier === 'object' &&
      (value as PortableSyncMetadata).entityVersions &&
      typeof (value as PortableSyncMetadata).entityVersions === 'object' &&
      (value as PortableSyncMetadata).tombstones &&
      typeof (value as PortableSyncMetadata).tombstones === 'object'
  )
}

export async function materializePortableImageBlocks(
  messageBlocks: ExportIndexedData['message_blocks'],
  portableImageAssets: PortableImageAsset[]
) {
  if (portableImageAssets.length === 0) {
    return messageBlocks
  }

  // Desktop migration payloads historically only carried image file references.
  // When restoring on mobile those desktop paths are meaningless, so we
  // materialize the embedded portable image bytes into app-local files first.
  const portableImageAssetMap = new Map(portableImageAssets.map(asset => [asset.fileId, asset]))
  const restoredFiles = new Map<string, FileMetadata>()
  const restoredBlocks = await Promise.all(
    messageBlocks.map(async block => {
      if (block.type !== MessageBlockType.IMAGE || !block.file?.id) {
        return block
      }

      const portableImageAsset = portableImageAssetMap.get(block.file.id)

      if (!portableImageAsset) {
        return block
      }

      try {
        let restoredFile = restoredFiles.get(portableImageAsset.fileId)

        if (!restoredFile) {
          restoredFile = await writeBase64File(portableImageAsset.data, {
            fileId: portableImageAsset.fileId,
            extension: portableImageAsset.ext,
            fileName: portableImageAsset.name || portableImageAsset.fileId,
            originName: portableImageAsset.origin_name || portableImageAsset.name || portableImageAsset.fileId
          })
          restoredFiles.set(portableImageAsset.fileId, restoredFile)
        }

        return {
          ...block,
          file: restoredFile,
          // Once the portable bytes are materialized into an app-local file,
          // prefer that canonical local path and drop any stale inline/data URL
          // fallback that would otherwise make the same image render twice.
          url: undefined
        } satisfies ImageMessageBlock
      } catch (error) {
        logger.warn(
          `Failed to materialize portable image asset ${portableImageAsset.fileId} during migration restore. Falling back to inline image data.`,
          error
        )

        return {
          ...block,
          url: block.url || portableImageAsset.data
        } satisfies ImageMessageBlock
      }
    })
  )

  if (restoredFiles.size > 0) {
    await fileDatabase.upsertFiles([...restoredFiles.values()])
    logger.info(`Materialized ${restoredFiles.size} portable image asset(s) into local app storage`)
  }

  return restoredBlocks
}

function getReferencedBlockFileId(block: unknown) {
  if (!block || typeof block !== 'object' || !('file' in block)) {
    return undefined
  }

  const file = (block as { file?: { id?: unknown } }).file
  return typeof file?.id === 'string' ? file.id : undefined
}

function collectReferencedBlockFileIds(messageBlocks: readonly unknown[]) {
  return new Set(messageBlocks.map(getReferencedBlockFileId).filter((fileId): fileId is string => Boolean(fileId)))
}

export async function cleanupOrphanedImportedFiles(
  candidateFileIds: Iterable<string>,
  activeMessageBlocks: readonly unknown[]
) {
  const activeFileIds = collectReferencedBlockFileIds(activeMessageBlocks)
  const orphanFileIds = Array.from(new Set(candidateFileIds)).filter(fileId => !activeFileIds.has(fileId))

  if (orphanFileIds.length === 0) {
    return []
  }

  const orphanFiles = (await Promise.all(orphanFileIds.map(fileId => fileDatabase.getFileById(fileId)))).filter(
    (file): file is FileMetadata => Boolean(file)
  )

  if (orphanFiles.length === 0) {
    return []
  }

  await deleteFiles(orphanFiles)
  logger.info(`Deleted ${orphanFiles.length} orphaned imported file(s) after sync reconciliation`)

  return orphanFiles.map(file => file.id)
}

function isDesktopMigrationAssistantsState(assistantsState: ImportReduxData['assistants']) {
  if (assistantsState.systemAssistants && assistantsState.systemAssistants.length > 0) {
    return false
  }

  if (assistantsState.defaultAssistant?.type && assistantsState.defaultAssistant.type !== 'system') {
    return true
  }

  return assistantsState.assistants.some(assistant => isSystemAssistantId(assistant.id))
}

async function loadSystemAssistantsForBackup(): Promise<Assistant[]> {
  const seededSystemAssistants = getSystemAssistants()
  const seededSystemAssistantMap = new Map(seededSystemAssistants.map(assistant => [assistant.id, assistant]))

  const persistedSystemAssistants = await Promise.all(
    SYSTEM_ASSISTANT_IDS.map(async assistantId => {
      try {
        return await assistantService.getAssistant(assistantId)
      } catch (error) {
        logger.warn(
          `Failed to load persisted system assistant ${assistantId}, falling back to bundled defaults.`,
          error
        )
        return null
      }
    })
  )

  return SYSTEM_ASSISTANT_IDS.map((assistantId, index) => {
    return persistedSystemAssistants[index] || seededSystemAssistantMap.get(assistantId)!
  })
}

export function normalizeAssistantsFromBackup(
  assistantsState: ImportReduxData['assistants'],
  llmState?: BackupLlmState
): NormalizedBackupAssistants {
  const seededSystemAssistants = getSystemAssistants()
  const seededSystemAssistantMap = new Map(seededSystemAssistants.map(assistant => [assistant.id, assistant]))
  const persistedSystemAssistantMap = new Map<string, Assistant>()
  const source = isDesktopMigrationAssistantsState(assistantsState) ? 'desktop-migration' : 'app-native'

  if (assistantsState.systemAssistants && assistantsState.systemAssistants.length > 0) {
    assistantsState.systemAssistants
      .filter(assistant => isSystemAssistantId(assistant.id))
      .forEach(assistant => persistedSystemAssistantMap.set(assistant.id, assistant))
  } else if (source === 'desktop-migration') {
    // Desktop migration packs still use `assistants.defaultAssistant` for the
    // desktop chat default assistant, not the mobile system "default" assistant.
    // Prefer the concrete assistant entry from `assistants[]` when it exists so
    // custom name / emoji / topics survive restore instead of being silently
    // replaced by the app's seeded local default assistant.
    const desktopDefaultAssistant =
      assistantsState.assistants.find(assistant => assistant.id === 'default') ?? assistantsState.defaultAssistant

    if (desktopDefaultAssistant?.id === 'default') {
      persistedSystemAssistantMap.set('default', desktopDefaultAssistant)
    }
  } else if (assistantsState.defaultAssistant && isSystemAssistantId(assistantsState.defaultAssistant.id)) {
    // Older mobile backups only persisted `defaultAssistant`. Keep supporting
    // them, but do not reuse this branch for desktop migration payloads because
    // desktop `defaultAssistant` has different semantics.
    persistedSystemAssistantMap.set(assistantsState.defaultAssistant.id, assistantsState.defaultAssistant)
  }

  const desktopPresetAssistants =
    source === 'desktop-migration'
      ? // Desktop migration payloads can carry agent presets inside
        // `assistants.presets`. App has no dedicated preset library, so the
        // portable fallback is to materialize them as external assistants and
        // preserve custom avatars/prompts instead of silently dropping them.
        (assistantsState.presets ?? []).filter(assistant => !isSystemAssistantId(assistant.id))
      : []

  const desktopSystemAssistantModels: Partial<
    Record<Exclude<SystemAssistantId, 'default'>, BackupLlmState['defaultModel']>
  > =
    source === 'desktop-migration'
      ? {
          // Desktop keeps system assistant model selections in the llm slice
          // instead of persisting them on the assistant objects themselves.
          // Quick/translate do not have a separate global preference on mobile,
          // so we bridge them onto the corresponding system assistants.
          quick: llmState?.quickModel ?? llmState?.topicNamingModel,
          translate: llmState?.translateModel
        }
      : {}

  const persistedDefaultAssistant = persistedSystemAssistantMap.get('default')
  const globalDefaultModel =
    llmState?.defaultModel ??
    persistedDefaultAssistant?.defaultModel ??
    persistedDefaultAssistant?.model ??
    seededSystemAssistantMap.get('default')?.defaultModel

  const systemAssistants = SYSTEM_ASSISTANT_IDS.map(assistantId => {
    const seededAssistant = seededSystemAssistantMap.get(assistantId)!
    const persistedAssistant = persistedSystemAssistantMap.get(assistantId)
    const bridgedDesktopModel = assistantId === 'default' ? undefined : desktopSystemAssistantModels[assistantId]
    const resolvedDefaultModel = bridgedDesktopModel ?? persistedAssistant?.defaultModel ?? seededAssistant.defaultModel
    const resolvedModel =
      bridgedDesktopModel ?? persistedAssistant?.model ?? resolvedDefaultModel ?? seededAssistant.model

    return {
      ...seededAssistant,
      ...persistedAssistant,
      defaultModel: resolvedDefaultModel,
      model: resolvedModel,
      id: assistantId,
      type: 'system' as const
    } satisfies Assistant
  })

  const externalAssistants = mergeAssistantsById([
    ...(isSystemAssistantId(assistantsState.defaultAssistant?.id ?? '')
      ? assistantsState.assistants
      : [assistantsState.defaultAssistant, ...assistantsState.assistants]),
    ...desktopPresetAssistants
  ])
    .filter(assistant => !isSystemAssistantId(assistant.id))
    .map(
      assistant =>
        ({
          ...assistant,
          topics: assistant.topics ?? [],
          type: 'external'
        }) as Assistant
    )

  return {
    systemAssistants,
    externalAssistants,
    globalDefaultModel,
    source
  }
}

export function getThemeModeFromBackupSettings(settings: ExportReduxData['settings']) {
  if (!settings.theme) {
    return undefined
  }

  return Object.values(ThemeMode).includes(settings.theme) ? settings.theme : undefined
}

export type RestoreStepId = 'clear_data' | 'receive_file' | 'restore_settings' | 'restore_messages'

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export type ProgressUpdate = {
  step: RestoreStepId
  status: StepStatus
  error?: string
}

type OnProgressCallback = (update: ProgressUpdate) => void

async function restoreIndexedDbData(
  data: ExportIndexedData,
  portableImageAssets: PortableImageAsset[],
  onProgress: OnProgressCallback,
  _dispatch: Dispatch
) {
  onProgress({ step: 'restore_messages', status: 'in_progress' })

  // 根据数据量动态调整批次大小
  const topicCount = data.topics.length
  const messageCount = data.messages.length
  const blockCount = data.message_blocks.length

  // 数据量越大，批次越小，避免单次操作占用太多内存
  const BATCH_SIZE = messageCount > 10000 ? 20 : messageCount > 1000 ? 50 : 100

  logger.info(`Processing ${topicCount} topics, ${messageCount} messages, ${blockCount} blocks`)
  logger.info(`Using batch size: ${BATCH_SIZE}`)

  // 获取数据库中现有的 assistant IDs，用于验证 topics
  const existingAssistants = await assistantDatabase.getAllAssistants()
  const existingAssistantIds = new Set(existingAssistants.map(a => a.id))
  logger.info(`Validating topics against ${existingAssistantIds.size} existing assistants`)

  // 检查并修复 topics 中的无效 assistantId
  const topicAssistantIds = new Set(data.topics.map(t => t.assistantId))
  const missingTopicAssistantIds = [...topicAssistantIds].filter(id => !existingAssistantIds.has(id))

  if (missingTopicAssistantIds.length > 0) {
    const affectedTopicsCount = data.topics.filter(t => missingTopicAssistantIds.includes(t.assistantId)).length
    logger.warn(
      `Fixed ${affectedTopicsCount} topics with missing assistant_id by replacing with "default". Missing IDs: ${missingTopicAssistantIds.join(', ')}`
    )

    data.topics = data.topics.map(topic => {
      if (missingTopicAssistantIds.includes(topic.assistantId)) {
        return {
          ...topic,
          assistantId: 'default'
        }
      }
      return topic
    })
  }

  // 分批处理 topics
  for (let i = 0; i < topicCount; i += BATCH_SIZE) {
    const batch = data.topics.slice(i, Math.min(i + BATCH_SIZE, topicCount))
    await topicDatabase.upsertTopics(batch)

    if (i % (BATCH_SIZE * 10) === 0 || i + BATCH_SIZE >= topicCount) {
      logger.info(`Topics: ${Math.min(i + BATCH_SIZE, topicCount)}/${topicCount}`)
    }
  }

  // 验证并修复 messages 中的外键引用
  const messageAssistantIds = new Set(data.messages.map(msg => msg.assistantId))
  const messageTopicIds = new Set(data.messages.map(msg => msg.topicId))
  const validTopicIds = new Set(data.topics.map(t => t.id))

  // 检查是否有 messages 引用了不存在的 assistantId
  const missingAssistantIds = [...messageAssistantIds].filter(id => !existingAssistantIds.has(id))
  if (missingAssistantIds.length > 0) {
    const affectedMessagesCount = data.messages.filter(msg => missingAssistantIds.includes(msg.assistantId)).length
    logger.warn(
      `Fixed ${affectedMessagesCount} messages with missing assistant_id by replacing with "default". Missing IDs: ${missingAssistantIds.join(', ')}`
    )

    data.messages = data.messages.map(msg => {
      if (missingAssistantIds.includes(msg.assistantId)) {
        return {
          ...msg,
          assistantId: 'default'
        }
      }
      return msg
    })
  }

  // 检查是否有 messages 引用了不存在的 topicId
  const missingTopicIds = [...messageTopicIds].filter(id => !validTopicIds.has(id))
  if (missingTopicIds.length > 0) {
    const originalCount = data.messages.length
    data.messages = data.messages.filter(msg => !missingTopicIds.includes(msg.topicId))
    const filteredCount = originalCount - data.messages.length

    if (filteredCount > 0) {
      logger.error(
        `Filtered out ${filteredCount} messages with invalid topic_id references. Missing topic IDs: ${missingTopicIds.join(', ')}`
      )
    }
  }

  // 分批处理 messages
  const finalMessageCount = data.messages.length
  for (let i = 0; i < finalMessageCount; i += BATCH_SIZE) {
    const batch = data.messages.slice(i, Math.min(i + BATCH_SIZE, finalMessageCount))
    await messageDatabase.upsertMessages(batch)

    if (i % (BATCH_SIZE * 10) === 0 || i + BATCH_SIZE >= finalMessageCount) {
      logger.info(`Messages: ${Math.min(i + BATCH_SIZE, finalMessageCount)}/${finalMessageCount}`)
    }
  }

  // 分批过滤和处理 message_blocks
  logger.info('Processing message blocks...')
  const validMessageIds = new Set(data.messages.map(msg => msg.id))
  let filteredCount = 0
  let processedBlocks = 0
  const portableImageBlocks = await materializePortableImageBlocks(data.message_blocks, portableImageAssets)

  for (let i = 0; i < blockCount; i += BATCH_SIZE) {
    const batch = portableImageBlocks.slice(i, Math.min(i + BATCH_SIZE, blockCount))
    const validBlocks = batch.filter(block => {
      const isValid = validMessageIds.has(block.messageId)
      if (!isValid) filteredCount++
      return isValid
    })

    if (validBlocks.length > 0) {
      await messageBlockDatabase.upsertBlocks(validBlocks)
      processedBlocks += validBlocks.length
    }

    if (i % (BATCH_SIZE * 10) === 0 || i + BATCH_SIZE >= blockCount) {
      logger.info(`Blocks: ${Math.min(i + BATCH_SIZE, blockCount)}/${blockCount} (valid: ${processedBlocks})`)
    }
  }

  if (filteredCount > 0) {
    logger.warn(`Filtered out ${filteredCount} message block(s) with invalid message_id references`)
  }

  // 清理 Set 对象
  validMessageIds.clear()

  // Invalidate caches after bulk import to ensure consistency
  topicService.invalidateCache()
  assistantService.invalidateCache()

  if (data.settings) {
    const avatarSetting = data.settings.find(setting => setting.id === 'image://avatar')

    if (avatarSetting) {
      await preferenceService.set('user.avatar', avatarSetting.value)
    }
  }

  logger.info('IndexedDB data restore completed')
  onProgress({ step: 'restore_messages', status: 'completed' })
}

async function restoreReduxData(
  data: ExportReduxData,
  onProgress: OnProgressCallback,
  _dispatch: Dispatch,
  webDavConfig?: WebDavConfig | null
) {
  onProgress({ step: 'restore_settings', status: 'in_progress' })
  await providerDatabase.upsertProviders(data.llm.providers)
  providerService.invalidateCache()
  await providerService.refreshAllProvidersCache()

  const { systemAssistants, externalAssistants, globalDefaultModel, source } = normalizeAssistantsFromBackup(
    data.assistants,
    data.llm
  )
  const assistants = [...systemAssistants, ...externalAssistants]
  const assistantsWithAvatarCount = assistants.filter(assistant => Boolean(assistant.avatar)).length

  logger.info(`Restoring ${assistants.length} assistants from ${source} backup payload`)
  logger.info(`Restoring ${assistantsWithAvatarCount} assistant avatar(s) from ${source} backup payload`)
  logger.info(`Restoring ${assistants.length} assistants`)
  await assistantDatabase.upsertAssistants(assistants)
  assistantService.syncAfterExternalMutation(assistants.map(assistant => assistant.id))

  await websearchProviderDatabase.upsertWebSearchProviders(data.websearch.providers)

  // 恢复 MCP 数据（如果存在，兼容旧备份）
  if (data.mcp?.servers && data.mcp.servers.length > 0) {
    logger.info(`Restoring ${data.mcp.servers.length} MCP servers`)
    await mcpDatabase.upsertMcps(data.mcp.servers)
  }

  await new Promise(resolve => setTimeout(resolve, 200)) // Delay between steps

  await preferenceService.set('user.name', data.settings.userName)
  const themeMode = getThemeModeFromBackupSettings(data.settings)

  if (themeMode) {
    await preferenceService.set('ui.theme_mode', themeMode)
  }

  if (globalDefaultModel) {
    // Desktop/app migration packs carry a global default model that is distinct
    // from the default assistant's actively selected model. Keep that split on
    // mobile so restoring migration data does not overwrite the default
    // assistant's current runtime model.
    await preferenceService.set('llm.default_model', globalDefaultModel)
  }

  if (webDavConfig) {
    saveStoredWebDavConfig(webDavConfig)
  }

  onProgress({ step: 'restore_settings', status: 'completed' })
}

async function restoreParsedBackupData(data: string, onProgress: OnProgressCallback, dispatch: Dispatch) {
  logger.info('Parsing and transforming backup data...')
  let parsedData = transformBackupData(data)
  const portableLanguage = parsedData.portableLanguage
  const portableSync = parsedData.portableSync
  const backupSource = parsedData.source

  logger.info('Restoring Redux data...')
  await restoreReduxData(parsedData.reduxData, onProgress, dispatch, parsedData.webDavConfig)

  // Redux data is written, release memory before restoring message-heavy payloads.
  // @ts-ignore
  parsedData.reduxData = null

  logger.info('Restoring IndexedDB data...')
  await restoreIndexedDbData(parsedData.indexedData, parsedData.portableImageAssets, onProgress, dispatch)

  const backupVersion = parsedData.appInitializationVersion

  // Indexed data is already committed, release memory before migrations.
  // @ts-ignore
  parsedData.indexedData = null
  // @ts-ignore
  parsedData = null

  const versionToSet = backupVersion ?? 1
  logger.info(`Setting app initialization version to ${versionToSet} and running incremental migrations...`)
  await preferenceService.set('app.initialization_version', versionToSet)
  await runAppDataMigrations()

  resetAppInitializationState()

  if (portableSync) {
    const [topics, messages, messageBlocks] = await Promise.all([
      topicDatabase.getTopics(),
      messageDatabase.getAllMessages(),
      messageBlockDatabase.getAllBlocks()
    ])
    const messageIds = new Set(messages.map(message => message.id))
    const syncedMessageBlocks = messageBlocks.filter(block => messageIds.has(block.messageId))
    const syncState = seedPortableSyncState(
      {
        topics,
        messages,
        messageBlocks: syncedMessageBlocks
      },
      portableSync
    )

    logger.info('Seeded portable sync lineage from restored backup', {
      source: backupSource,
      replicaId: portableSync.replicaId,
      localReplicaId: syncState.replicaId,
      topicCount: topics.length,
      messageCount: messages.length,
      blockCount: syncedMessageBlocks.length
    })
  }

  if (portableLanguage) {
    // Desktop migration payloads may carry desktop-style locale tags such as
    // zh-CN/zh-TW. Normalize and re-apply them after the seed/reset flow so the
    // restore process does not leave the running app stuck on the device default
    // language (commonly English on test devices).
    storage.set('language', portableLanguage)
    await i18n.changeLanguage(portableLanguage)
    assistantService.resetBuiltInAssistants()
  }
}

export async function restore(
  backupFile: Omit<FileMetadata, 'md5'>,
  onProgress: OnProgressCallback,
  dispatch: Dispatch
) {
  if (!DEFAULT_DOCUMENTS_STORAGE.exists) {
    DEFAULT_DOCUMENTS_STORAGE.create({ intermediates: true, overwrite: true })
  }

  let unzipPath: string | undefined

  try {
    const extractedDirPath = Paths.join(DEFAULT_DOCUMENTS_STORAGE, backupFile.name.replace('.zip', ''))
    logger.info('Unzipping backup file...')
    await unzip(backupFile.path, extractedDirPath)
    unzipPath = extractedDirPath

    const dataFile = new File(extractedDirPath, 'data.json')

    // TODO: 长期方案 - 重构备份格式为分文件存储，避免读取大 JSON 文件
    // 当前依赖 android:largeHeap="true" 来处理大文件（>100MB）
    logger.info('Starting to read backup file, size:', dataFile.size, 'bytes')
    const fileContent = await dataFile.text()
    await restoreParsedBackupData(fileContent, onProgress, dispatch)

    logger.info('Restore completed successfully')
  } catch (error) {
    logger.error('restore error: ', error)
    throw error
  } finally {
    if (unzipPath) {
      try {
        new Directory(unzipPath).delete()
      } catch (cleanupError) {
        logger.error('Failed to cleanup temporary directory: ', cleanupError)
      }
    }
  }
}

export function transformBackupData(data: string): {
  reduxData: ExportReduxData
  indexedData: ExportIndexedData
  portableImageAssets: PortableImageAsset[]
  portableSync?: PortableSyncMetadata
  appInitializationVersion?: number
  webDavConfig?: WebDavConfig | null
  portableLanguage?: LanguageVarious
  source: NormalizedBackupAssistants['source']
} {
  let orginalData: any

  try {
    // 解析主 JSON - 这步无法避免，但可以立即释放原始字符串
    logger.info('Parsing main JSON structure...')
    orginalData = JSON.parse(data)
    // data 参数会在函数返回后自动释放
  } catch (error) {
    logger.error('Failed to parse backup JSON:', error)
    throw new Error('Invalid backup file format')
  }

  // 提取 Redux 数据
  logger.info('Extracting Redux data...')
  let localStorageData = orginalData.localStorage
  const portableImageAssets = Array.isArray(orginalData.portableImageAssets)
    ? orginalData.portableImageAssets.filter(isPortableImageAsset)
    : []
  const portableSync = isPortableSyncMetadata(orginalData.portableSync) ? orginalData.portableSync : undefined

  // 从 IndexedDB 提取 topics（这是数据的真实来源，包含所有 topics）
  const indexedDb: ImportIndexedData = orginalData.indexedDB

  // 提取 app_initialization_version（旧备份可能没有此字段）
  const appInitializationVersion: number | undefined = orginalData.app_initialization_version

  orginalData = null
  let persistDataString = localStorageData['persist:cherry-studio']
  let rawReduxData = JSON.parse(persistDataString)
  persistDataString = null
  const settingsData = sanitizePortableBackupSettings(JSON.parse(rawReduxData.settings))
  const webDavConfig = getWebDavConfigFromBackup({
    localStorage: localStorageData,
    settings: settingsData
  })
  const portableLanguage =
    typeof localStorageData?.language === 'string'
      ? normalizeLanguageTag(localStorageData.language)
      : typeof settingsData.language === 'string'
        ? normalizeLanguageTag(settingsData.language)
        : undefined
  localStorageData = null

  const assistantsState: ImportReduxData['assistants'] = JSON.parse(rawReduxData.assistants)
  const reduxData: ImportReduxData = {
    assistants: assistantsState,
    llm: JSON.parse(rawReduxData.llm),
    websearch: JSON.parse(rawReduxData.websearch),
    settings: settingsData,
    mcp: rawReduxData.mcp ? JSON.parse(rawReduxData.mcp) : undefined
  }

  rawReduxData = null
  let indexedDbData: ExportIndexedData = {
    topics: [],
    message_blocks: [],
    messages: [],
    settings: indexedDb.settings || []
  }
  // 如果用户选择了恢复消息
  if (indexedDb.topics && indexedDb.message_blocks) {
    logger.info('Processing topics and messages...')
    const { systemAssistants, externalAssistants } = normalizeAssistantsFromBackup(reduxData.assistants, reduxData.llm)
    const parseTimestamp = (dateVal: any, fallback: number): number => {
      if (!dateVal) return fallback
      if (typeof dateVal === 'number') return dateVal
      if (typeof dateVal === 'string') {
        const asNum = Number(dateVal)
        if (!isNaN(asNum) && asNum > 0) return asNum
      }
      const t = new Date(dateVal).getTime()
      return isNaN(t) ? fallback : t
    }

    const topicsFromReduxMap = new Map<string, Topic>()

    for (const assistant of [...systemAssistants, ...externalAssistants]) {
      for (const topic of assistant.topics ?? []) {
        topicsFromReduxMap.set(topic.id, topic)
      }
    }

    const topicsFromRedux = [...topicsFromReduxMap.values()]

    const allMessages: Message[] = []
    const messagesByTopicId: Record<string, Message[]> = {}

    // 从 IndexedDB 提取所有 topics 和 messages
    for (const topic of indexedDb.topics) {
      if (topic.messages && topic.messages.length > 0) {
        const messagesWithFixedDates = topic.messages.map(msg => ({
          ...msg,
          createdAt: parseTimestamp(msg.createdAt, Date.now()),
          updatedAt: msg.updatedAt ? parseTimestamp(msg.updatedAt, Date.now()) : undefined
        }))
        messagesByTopicId[topic.id] = messagesWithFixedDates
        allMessages.push(...messagesWithFixedDates)
      }
    }

    logger.info(`Extracted ${allMessages.length} messages from ${indexedDb.topics.length} topics`)

    // 合并 topics：使用 IndexedDB 的 topics，Redux 的元数据用于筛选脏数据
    const topicsWithMessages = indexedDb.topics
      .map(indexedTopic => {
        // 尝试从 Redux 中获取对应的 topic 元数据
        const reduxTopic = topicsFromRedux.find(t => t.id === indexedTopic.id)

        // 如果redux中不存在，则跳过当前数据
        if (!reduxTopic) {
          return
        }

        return {
          id: indexedTopic.id,
          assistantId: reduxTopic?.assistantId ?? 'default',
          name: reduxTopic?.name ?? 'Untitled Topic',
          createdAt: parseTimestamp(reduxTopic?.createdAt, Date.now()),
          updatedAt: reduxTopic?.updatedAt ? parseTimestamp(reduxTopic.updatedAt, Date.now()) : parseTimestamp(reduxTopic?.createdAt, Date.now()),
          isLoading: reduxTopic?.isLoading ?? false
        } as Topic
      })
      .filter((topic): topic is Topic => topic !== undefined)

    topicsFromReduxMap.clear()
    indexedDbData.messages = allMessages
    indexedDbData.topics = topicsWithMessages
    indexedDbData.message_blocks = (indexedDb.message_blocks || []).map(block => ({
      ...block,
      createdAt: parseTimestamp(block.createdAt, Date.now()),
      updatedAt: block.updatedAt ? parseTimestamp(block.updatedAt, Date.now()) : undefined
    }))
    logger.info('Backup data transformation completed')
  }

  return {
    reduxData: reduxData,
    indexedData: indexedDbData,
    portableImageAssets,
    portableSync,
    appInitializationVersion,
    webDavConfig,
    portableLanguage,
    source: isDesktopMigrationAssistantsState(assistantsState) ? 'desktop-migration' : 'app-native'
  }
}

async function getAllData(): Promise<string> {
  try {
    const [providers, webSearchProviders, assistants, topics, messages, messageBlocks, mcpServers, systemAssistants] =
      await Promise.all([
        providerDatabase.getAllProviders(),
        websearchProviderDatabase.getAllWebSearchProviders(),
        assistantService.getExternalAssistants(),
        topicService.getTopics(),
        messageDatabase.getAllMessages(),
        messageBlockDatabase.getAllBlocks(),
        mcpDatabase.getMcps(),
        loadSystemAssistantsForBackup()
      ])

    // Get preferences for backup
    const userName = await preferenceService.get('user.name')
    const userAvatar = await preferenceService.get('user.avatar')
    const searchWithTime = await preferenceService.get('websearch.search_with_time')
    const maxResults = await preferenceService.get('websearch.max_results')
    const overrideSearchService = await preferenceService.get('websearch.override_search_service')
    const contentLimit = await preferenceService.get('websearch.content_limit')
    const appInitializationVersion = await preferenceService.get('app.initialization_version')
    const globalDefaultModel = await preferenceService.get('llm.default_model')
    const themeMode = await preferenceService.get('ui.theme_mode')
    const webDavConfig = getStoredWebDavConfig()
    const currentLanguage = storage.getString('language')

    const defaultAssistant =
      systemAssistants.find(assistant => assistant.id === 'default') || systemAssistants[0] || null

    const topicsByAssistantId = topics.reduce<Record<string, Topic[]>>((accumulator, topic) => {
      if (!accumulator[topic.assistantId]) {
        accumulator[topic.assistantId] = []
      }

      accumulator[topic.assistantId].push(topic)
      return accumulator
    }, {})

    const defaultAssistantPayload: Assistant = defaultAssistant
      ? {
          ...defaultAssistant,
          topics: topicsByAssistantId[defaultAssistant.id] ?? defaultAssistant.topics ?? []
        }
      : {
          id: 'default',
          name: 'Default Assistant',
          prompt: '',
          topics: topicsByAssistantId['default'] ?? [],
          type: 'system'
        }

    const systemAssistantsPayload = systemAssistants.map(assistant => ({
      ...assistant,
      topics: topicsByAssistantId[assistant.id] ?? assistant.topics ?? []
    }))

    const assistantsWithTopics = assistants.map(assistant => ({
      ...assistant,
      topics: topicsByAssistantId[assistant.id] ?? assistant.topics ?? []
    }))

    const assistantsPayload = {
      defaultAssistant: defaultAssistantPayload,
      systemAssistants: systemAssistantsPayload,
      assistants: assistantsWithTopics
    }

    const llmPayload = {
      providers,
      defaultModel: globalDefaultModel
    }

    const websearchPayload = {
      searchWithTime,
      maxResults,
      overrideSearchService,
      contentLimit,
      providers: webSearchProviders
    }

    const settingsPayload = {
      userName,
      theme: themeMode,
      ...getWebDavBackupSettings(webDavConfig)
    }

    const mcpPayload = {
      servers: mcpServers
    }

    const persistDataString = JSON.stringify({
      assistants: JSON.stringify(assistantsPayload),
      llm: JSON.stringify(llmPayload),
      websearch: JSON.stringify(websearchPayload),
      settings: JSON.stringify(settingsPayload),
      mcp: JSON.stringify(mcpPayload)
    })

    const localStorage: Record<string, string> = {
      'persist:cherry-studio': persistDataString,
      [WEBDAV_CONFIG_STORAGE_KEY]: JSON.stringify(webDavConfig)
    }

    if (currentLanguage) {
      localStorage.language = normalizeLanguageTag(currentLanguage)
    }

    const messagesByTopic = messages.reduce<Record<string, Message[]>>((accumulator, message) => {
      if (!accumulator[message.topicId]) {
        accumulator[message.topicId] = []
      }

      accumulator[message.topicId].push(message)
      return accumulator
    }, {})

    const indexedSettings: Setting[] = userAvatar
      ? [
          {
            id: 'image://avatar',
            value: userAvatar
          }
        ]
      : []

    const indexedDB: ImportIndexedData = {
      topics: topics.map(topic => ({
        id: topic.id,
        messages: messagesByTopic[topic.id] ?? []
      })),
      message_blocks: messageBlocks,
      settings: indexedSettings
    }

    const backupData = JSON.stringify({
      time: Date.now(),
      version: 5,
      app_initialization_version: appInitializationVersion,
      indexedDB,
      localStorage: localStorage
    })

    return backupData
  } catch (error) {
    logger.error('Error occurred during backup', error)
    throw error
  }
}

async function zipBackupData(backupData: string) {
  if (!DEFAULT_BACKUP_STORAGE.exists) {
    DEFAULT_BACKUP_STORAGE.create({ intermediates: true, idempotent: true })
  }

  const tempDirectory = new Directory(DEFAULT_BACKUP_STORAGE, `tmp-${Date.now()}`)
  tempDirectory.create({ intermediates: true })

  try {
    const dataFile = new File(tempDirectory, 'data.json')

    if (dataFile.exists) {
      dataFile.delete()
    }

    dataFile.write(backupData)

    const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`
    const zipFile = new File(DEFAULT_BACKUP_STORAGE, filename)

    if (zipFile.exists) {
      zipFile.delete()
    }

    await zip([dataFile.uri], zipFile.uri)

    return zipFile.uri
  } catch (error) {
    logger.error('Failed to create backup zip:', error)
    throw error
  } finally {
    try {
      tempDirectory.delete()
    } catch (cleanupError) {
      logger.error('Failed to cleanup temporary backup directory:', cleanupError)
    }
  }
}

export async function backup() {
  // 1. 获取备份数据 json格式
  // 主要备份 providers websearchProviders assistants
  // topics messages message_blocks settings
  const backupData = await getAllData()
  // 2. 保存到zip中
  const backupFile = await zipBackupData(backupData)
  // 3. 返回文件路径
  return backupFile
}
