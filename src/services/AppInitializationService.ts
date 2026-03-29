import { assistantDatabase, mcpDatabase, providerDatabase, topicDatabase, websearchProviderDatabase } from '@database'
import { db } from '@db'
import { seedDatabase } from '@db/seeding'
import * as Localization from 'expo-localization'

import { getSystemAssistants } from '@/config/assistants'
import { normalizeLanguageTag } from '@/config/languages'
import { initBuiltinMcp } from '@/config/mcp'
import { SYSTEM_PROVIDERS, SYSTEM_PROVIDERS_CONFIG } from '@/config/providers'
import { getWebSearchProviders } from '@/config/websearchProviders'
import type { Assistant } from '@/types/assistant'
import { storage } from '@/utils'

import { assistantService, getDefaultAssistant } from './AssistantService'
import { resolveValidCurrentTopicId } from './currentTopicUtils'
import { loggerService } from './LoggerService'
import { mcpService } from './McpService'
import { preferenceService } from './PreferenceService'
import { providerService } from './ProviderService'
import { topicService } from './TopicService'

type AppDataMigration = {
  version: number
  app_version: string
  description: string
  migrate: () => Promise<void>
}

const logger = loggerService.withContext('AppInitializationService')

const APP_DATA_MIGRATIONS: AppDataMigration[] = [
  {
    version: 1,
    app_version: '0.1.0',
    description: 'Initial app data seeding',
    migrate: async () => {
      await seedDatabase(db)

      // Use direct database access for initial seeding (performance)
      // AssistantService cache will be built naturally as the app is used
      const systemAssistants = getSystemAssistants()
      await assistantDatabase.upsertAssistants(systemAssistants)

      await providerDatabase.upsertProviders(SYSTEM_PROVIDERS)

      const websearchProviders = getWebSearchProviders()
      await websearchProviderDatabase.upsertWebSearchProviders(websearchProviders)

      const locales = Localization.getLocales()
      if (locales.length > 0 || storage.getString('language')) {
        // Reset/restore flows re-run the v1 seed before replaying backup data.
        // Keep any existing in-app language instead of blindly overwriting it
        // with the device locale, otherwise a Chinese app can be reset to
        // English before backup language restoration runs.
        const resolvedLanguage = normalizeLanguageTag(storage.getString('language') || locales[0]?.languageTag)
        storage.set('language', resolvedLanguage)
      }

      const builtinMcp = initBuiltinMcp()
      await mcpDatabase.upsertMcps(builtinMcp)
    }
  },
  {
    version: 2,
    app_version: '0.1.3',
    description: 'Sync built-in MCP servers (add @cherry/shortcuts)',
    migrate: async () => {
      // Get existing MCP servers from database
      const existingMcps = await mcpDatabase.getMcps()
      const existingIds = new Set(existingMcps.map(mcp => mcp.id))

      // Get all built-in MCP servers
      const builtinMcp = initBuiltinMcp()

      // Filter to only add new MCP servers that don't exist yet
      const newMcps = builtinMcp.filter(mcp => !existingIds.has(mcp.id))

      if (newMcps.length > 0) {
        await mcpDatabase.upsertMcps(newMcps)
        logger.info(`Added ${newMcps.length} new built-in MCP server(s): ${newMcps.map(m => m.id).join(', ')}`)
      } else {
        logger.info('No new built-in MCP servers to add')
      }
    }
  },
  {
    version: 3,
    app_version: '0.1.4',
    description: 'Update AI Gateway host to new endpoint',
    migrate: async () => {
      const aiGatewayProvider = await providerDatabase.getProviderById('ai-gateway')
      const desiredHost = SYSTEM_PROVIDERS_CONFIG['ai-gateway']?.apiHost

      if (!desiredHost) {
        logger.warn('AI Gateway provider configuration missing desired host; skipping migration')
        return
      }

      if (!aiGatewayProvider) {
        logger.info('AI Gateway provider not found in database; skipping host update')
        return
      }

      if (aiGatewayProvider.apiHost === desiredHost) {
        logger.info('AI Gateway provider already uses the updated host')
        return
      }

      await providerDatabase.upsertProviders([
        {
          ...aiGatewayProvider,
          apiHost: desiredHost
        }
      ])

      logger.info(`AI Gateway provider host updated to ${desiredHost}`)
    }
  },
  {
    version: 4,
    app_version: '0.1.5',
    description: 'Backfill missing system assistants without overwriting user-selected models',
    migrate: async () => {
      const systemAssistants = getSystemAssistants()
      const assistantsToUpsert: Assistant[] = []

      for (const seededAssistant of systemAssistants) {
        let existingAssistant: Assistant | null = null

        try {
          existingAssistant = await assistantDatabase.getAssistantById(seededAssistant.id)
        } catch {
          existingAssistant = null
        }

        if (!existingAssistant) {
          assistantsToUpsert.push(seededAssistant)
          continue
        }

        const mergedAssistant = {
          ...existingAssistant,
          type: 'system' as const
        }

        let shouldUpsert = existingAssistant.type !== 'system'

        if (!existingAssistant.defaultModel && seededAssistant.defaultModel) {
          mergedAssistant.defaultModel = seededAssistant.defaultModel
          shouldUpsert = true
        }

        if (!existingAssistant.model && mergedAssistant.defaultModel) {
          // System assistants are user-configurable. We only backfill missing
          // model/defaultModel values here and never reset an explicit selection.
          mergedAssistant.model = mergedAssistant.defaultModel
          shouldUpsert = true
        }

        if (shouldUpsert) {
          assistantsToUpsert.push(mergedAssistant)
        }
      }

      if (assistantsToUpsert.length > 0) {
        await assistantDatabase.upsertAssistants(assistantsToUpsert)
        logger.info(`Synced ${assistantsToUpsert.length} system assistant record(s)`)
      } else {
        logger.info('System assistants already in sync')
      }
    }
  }
]

const LATEST_APP_DATA_VERSION = APP_DATA_MIGRATIONS[APP_DATA_MIGRATIONS.length - 1]?.version ?? 0

export function resetAppInitializationState(): void {
  preferenceService.clearCache()
  assistantService.clearCache()
  providerService.clearCache()
  topicService.resetState()
  mcpService.invalidateCache()
  logger.info('App initialization state reset')
}

let currentTopicPromise: Promise<void> | null = null

export async function ensureValidCurrentTopic(): Promise<void> {
  if (currentTopicPromise) {
    return currentTopicPromise
  }

  currentTopicPromise = (async () => {
    try {
      const currentTopicId = await preferenceService.get('topic.current_id')

      const [topics, assistants] = await Promise.all([topicDatabase.getTopics(), assistantDatabase.getAllAssistants()])
      const validAssistantIds = new Set(assistants.map(assistant => assistant.id))
      const nextTopicId = resolveValidCurrentTopicId({
        currentTopicId,
        topics,
        validAssistantIds
      })

      if (nextTopicId) {
        await topicService.switchToTopic(nextTopicId, { refreshFromDatabase: true })
        if (currentTopicId === nextTopicId) {
          logger.info(`Rehydrated current topic: ${nextTopicId}`)
        } else {
          logger.info(`Switched current topic to valid fallback: ${nextTopicId}`)
        }
        return
      }

      if (currentTopicId) {
        logger.warn(`Current topic ${currentTopicId} is invalid after reconciliation, creating replacement topic`)
      }

      // No valid topics exist - create one with default assistant
      const defaultAssistant = await getDefaultAssistant()
      if (defaultAssistant) {
        // We MUST await the creation here to ensure it's persisted before anything else runs
        const newTopic = await topicService.createTopic(defaultAssistant)
        await topicService.switchToTopic(newTopic.id)
        logger.info(`Created new topic: ${newTopic.id}`)
      }
    } finally {
      currentTopicPromise = null
    }
  })()

  return currentTopicPromise
}

let migrationPromise: Promise<void> | null = null

export async function runAppDataMigrations(): Promise<void> {
  if (migrationPromise) {
    return migrationPromise
  }

  migrationPromise = (async () => {
    try {
      const currentVersion = await preferenceService.get('app.initialization_version')

      if (currentVersion >= LATEST_APP_DATA_VERSION) {
        logger.info(`App data already up to date at version ${currentVersion}`)

        // Initialize ProviderService cache (loads default provider)
        await providerService.initialize()

        // Ensure a valid current topic exists
        await ensureValidCurrentTopic()

        return
      }

      const pendingMigrations = APP_DATA_MIGRATIONS.filter(migration => migration.version > currentVersion).sort(
        (a, b) => a.version - b.version
      )

      logger.info(
        `Preparing to run ${pendingMigrations.length} app data migration(s) from version ${currentVersion} to ${LATEST_APP_DATA_VERSION}`
      )

      for (const migration of pendingMigrations) {
        logger.info(`Running app data migration v${migration.version}: ${migration.description}`)

        try {
          await migration.migrate()
          await preferenceService.set('app.initialization_version', migration.version)
          logger.info(`Completed app data migration v${migration.version}`)
        } catch (error) {
          logger.error(`App data migration v${migration.version} failed`, error as Error)
          throw error
        }
      }

      logger.info(`App data migrations completed. Current version: ${LATEST_APP_DATA_VERSION}`)

      // Initialize ProviderService cache (loads default provider)
      await providerService.initialize()

      // Ensure a valid current topic exists
      await ensureValidCurrentTopic()
    } catch (error) {
      // Clear promise on failure so it can be retried if needed
      migrationPromise = null
      throw error
    }
  })()

  return migrationPromise
}

export function getAppDataVersion(): number {
  return LATEST_APP_DATA_VERSION
}

