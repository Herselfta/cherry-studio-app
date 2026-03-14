import { storage } from '@/utils'

import { loggerService } from './LoggerService'

const logger = loggerService.withContext('WebDavConfigService')

export const WEBDAV_CONFIG_STORAGE_KEY = 'webdav_config_v1'
export const DEFAULT_WEBDAV_PATH = '/CherryStudio'

export interface WebDavConfig {
  host: string
  user: string
  password: string
  path: string
}

export interface BackupWebDavSettings {
  webdavHost?: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
}

export function normalizeWebDavPath(path?: string) {
  const trimmedPath = path?.trim() ?? ''

  if (!trimmedPath) {
    return DEFAULT_WEBDAV_PATH
  }

  if (/^\/+$/.test(trimmedPath)) {
    return '/'
  }

  const normalized = trimmedPath.replace(/^\/+/, '').replace(/\/+$/, '')
  return normalized ? `/${normalized}` : DEFAULT_WEBDAV_PATH
}

export function normalizeWebDavConfig(config: Partial<WebDavConfig>): WebDavConfig {
  return {
    host: config.host?.trim() ?? '',
    user: config.user?.trim() ?? '',
    password: config.password ?? '',
    path: normalizeWebDavPath(config.path)
  }
}

export function hasValidWebDavConfig(config: Partial<WebDavConfig>) {
  const normalized = normalizeWebDavConfig(config)
  return Boolean(normalized.host && normalized.user && normalized.password)
}

export function getStoredWebDavConfig(): WebDavConfig {
  const rawConfig = storage.getString(WEBDAV_CONFIG_STORAGE_KEY)

  if (!rawConfig) {
    return normalizeWebDavConfig({})
  }

  try {
    return normalizeWebDavConfig(JSON.parse(rawConfig))
  } catch (error) {
    logger.warn('Failed to parse stored WebDAV config', error as Error)
    return normalizeWebDavConfig({})
  }
}

export function saveStoredWebDavConfig(config: Partial<WebDavConfig>) {
  const normalized = normalizeWebDavConfig(config)
  storage.set(WEBDAV_CONFIG_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function getWebDavBackupSettings(config: Partial<WebDavConfig>): BackupWebDavSettings {
  const normalized = normalizeWebDavConfig(config)

  return {
    webdavHost: normalized.host,
    webdavUser: normalized.user,
    webdavPass: normalized.password,
    webdavPath: normalized.path
  }
}

export function getWebDavConfigFromBackup({
  localStorage,
  settings
}: {
  localStorage?: Record<string, string> | null
  settings?: BackupWebDavSettings | null
}) {
  const rawConfig = localStorage?.[WEBDAV_CONFIG_STORAGE_KEY]

  if (rawConfig) {
    try {
      return normalizeWebDavConfig(JSON.parse(rawConfig))
    } catch (error) {
      logger.warn('Failed to parse WebDAV config from backup localStorage', error as Error)
    }
  }

  const hasDesktopSettings =
    settings && ['webdavHost', 'webdavUser', 'webdavPass', 'webdavPath'].some(key => key in settings)

  if (!hasDesktopSettings) {
    return null
  }

  return normalizeWebDavConfig({
    host: settings.webdavHost,
    user: settings.webdavUser,
    password: settings.webdavPass,
    path: settings.webdavPath
  })
}
