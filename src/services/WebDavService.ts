import { Buffer } from 'buffer'
import dayjs from 'dayjs'
import { File } from 'expo-file-system'
import * as LegacyFileSystem from 'expo-file-system/legacy'
import { XMLParser } from 'fast-xml-parser'

import { DEFAULT_BACKUP_STORAGE } from '@/constants/storage'

import { backup } from './BackupService'
import { loggerService } from './LoggerService'
import { exportMobileSyncPayload, isMobileSyncRemoteFile } from './MobileSyncService'
import {
  hasValidWebDavConfig,
  normalizeWebDavConfig,
  normalizeWebDavPath,
  type WebDavConfig
} from './WebDavConfigService'

const logger = loggerService.withContext('WebDavService')
export {
  DEFAULT_WEBDAV_PATH,
  getStoredWebDavConfig as getWebDavConfig,
  hasValidWebDavConfig,
  normalizeWebDavConfig,
  normalizeWebDavPath,
  saveStoredWebDavConfig as saveWebDavConfig,
  WEBDAV_CONFIG_STORAGE_KEY
} from './WebDavConfigService'

export interface WebDavBackupFile {
  fileName: string
  size: number
  modifiedTime: string
}

export type WebDavRemoteFile = WebDavBackupFile

type WebDavPropstat = {
  status?: string
  prop?: {
    displayname?: string
    getcontentlength?: string | number
    getlastmodified?: string
    resourcetype?: {
      collection?: unknown
    }
  }
}

type WebDavResponseNode = {
  href?: string
  propstat?: WebDavPropstat | WebDavPropstat[]
}

const propfindParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true
})

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function decodeHrefSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function sanitizeErrorMessage(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseWebDavRemoteFiles(xml: string): WebDavRemoteFile[] {
  const parsed = propfindParser.parse(xml) as {
    multistatus?: {
      response?: WebDavResponseNode | WebDavResponseNode[]
    }
  }
  const responses = toArray(parsed.multistatus?.response)

  return responses
    .map(response => {
      const propstats = toArray(response.propstat)
      const successfulPropstat = propstats.find(propstat => propstat.status?.includes(' 200 ')) ?? propstats[0]
      const props = successfulPropstat?.prop

      if (!props) {
        return null
      }

      const hrefSegments = response.href?.split('/').filter(Boolean) ?? []
      const fallbackName = hrefSegments.length > 0 ? decodeHrefSegment(hrefSegments[hrefSegments.length - 1]) : ''
      const fileName = props.displayname || fallbackName
      const isCollection = props.resourcetype && 'collection' in props.resourcetype

      if (!fileName || isCollection) {
        return null
      }

      return {
        fileName,
        size: Number(props.getcontentlength || 0),
        modifiedTime: props.getlastmodified || ''
      } satisfies WebDavRemoteFile
    })
    .filter((file): file is WebDavRemoteFile => file !== null)
    .sort((left, right) => {
      const leftTime = left.modifiedTime ? new Date(left.modifiedTime).getTime() : 0
      const rightTime = right.modifiedTime ? new Date(right.modifiedTime).getTime() : 0
      return rightTime - leftTime
    })
}

export function parseWebDavBackupFiles(xml: string): WebDavBackupFile[] {
  return parseWebDavRemoteFiles(xml).filter(file => file.fileName.endsWith('.zip'))
}

function encodePathSegments(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function createBasicAuthHeader(config: WebDavConfig) {
  return `Basic ${Buffer.from(`${config.user}:${config.password}`, 'utf8').toString('base64')}`
}

function createWebDavUrl(config: WebDavConfig, fileName?: string) {
  const baseHost = config.host.replace(/\/+$/, '')
  const pathSegments = encodePathSegments(config.path)
  const fileSegment = fileName ? encodeURIComponent(fileName) : ''

  if (!pathSegments && !fileSegment) {
    return baseHost
  }

  if (!pathSegments) {
    return `${baseHost}/${fileSegment}`
  }

  if (!fileSegment) {
    return `${baseHost}/${pathSegments}`
  }

  return `${baseHost}/${pathSegments}/${fileSegment}`
}

async function readResponseError(response: Response) {
  try {
    const text = await response.text()
    const sanitized = sanitizeErrorMessage(text)
    return sanitized || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

async function webDavRequest(
  config: WebDavConfig,
  fileName: string | undefined,
  init: globalThis.RequestInit,
  expectedStatuses: number[]
) {
  const response = await fetch(createWebDavUrl(config, fileName), {
    ...init,
    headers: {
      Authorization: createBasicAuthHeader(config),
      ...init.headers
    }
  })

  if (!expectedStatuses.includes(response.status)) {
    const message = await readResponseError(response)
    throw new Error(`HTTP ${response.status}${message ? `: ${message}` : ''}`)
  }

  return response
}

async function ensureBackupDirectoryExists(config: WebDavConfig) {
  const host = config.host.replace(/\/+$/, '')
  const pathSegments = normalizeWebDavPath(config.path).split('/').filter(Boolean)

  if (pathSegments.length === 0) {
    return
  }

  let currentPath = ''
  for (const segment of pathSegments) {
    currentPath += `/${segment}`
    const response = await fetch(`${host}/${encodePathSegments(currentPath)}`, {
      method: 'MKCOL',
      headers: {
        Authorization: createBasicAuthHeader(config)
      }
    })

    if ([200, 201, 204, 301, 302, 405].includes(response.status)) {
      continue
    }

    throw new Error(await readResponseError(response))
  }
}

function validateConfig(config: Partial<WebDavConfig>) {
  const normalized = normalizeWebDavConfig(config)

  if (!hasValidWebDavConfig(normalized)) {
    throw new Error('INVALID_CONFIG')
  }

  try {
    new URL(normalized.host)
  } catch {
    throw new Error('INVALID_HOST')
  }

  return normalized
}

export async function checkWebDavConnection(config: Partial<WebDavConfig>) {
  const normalized = validateConfig(config)
  await ensureBackupDirectoryExists(normalized)
  await webDavRequest(
    normalized,
    undefined,
    {
      method: 'PROPFIND',
      headers: {
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8'
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
  </d:prop>
</d:propfind>`
    },
    [207]
  )

  return normalized
}

export async function listWebDavBackupFiles(config: Partial<WebDavConfig>) {
  const normalized = validateConfig(config)

  try {
    const response = await webDavRequest(
      normalized,
      undefined,
      {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8'
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
    <d:getcontentlength />
    <d:getlastmodified />
    <d:resourcetype />
  </d:prop>
</d:propfind>`
      },
      [207]
    )

    return parseWebDavBackupFiles(await response.text())
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('HTTP 404')) {
      return []
    }

    throw error
  }
}

export async function listWebDavMobileSyncFiles(config: Partial<WebDavConfig>) {
  const normalized = validateConfig(config)

  try {
    const response = await webDavRequest(
      normalized,
      undefined,
      {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8'
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
    <d:getcontentlength />
    <d:getlastmodified />
    <d:resourcetype />
  </d:prop>
</d:propfind>`
      },
      [207]
    )

    return parseWebDavRemoteFiles(await response.text()).filter(file => isMobileSyncRemoteFile(file.fileName))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('HTTP 404')) {
      return []
    }

    throw error
  }
}

export async function backupToWebDav(config: Partial<WebDavConfig>) {
  const normalized = validateConfig(config)
  await ensureBackupDirectoryExists(normalized)

  const backupUri = await backup()
  const backupFile = new File(backupUri)
  const fileName = backupUri.split('/').pop() || `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`

  try {
    const bytes = await backupFile.bytes()

    await webDavRequest(
      normalized,
      fileName,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/zip'
        },
        body: bytes
      },
      [200, 201, 204]
    )

    return {
      fileName,
      size: backupFile.size || bytes.byteLength,
      modifiedTime: new Date().toISOString()
    } satisfies WebDavBackupFile
  } finally {
    try {
      if (backupFile.exists) {
        backupFile.delete()
      }
    } catch (error) {
      logger.warn('Failed to cleanup temporary WebDAV backup file', error as Error)
    }
  }
}

function buildMobileSyncFileName() {
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  return `cherry-studio.mobile-sync.${timestamp}.mobile.json`
}

export function normalizeMobileSyncWebDavFileName(fileName?: string) {
  const trimmed = fileName?.trim()

  if (!trimmed) {
    return buildMobileSyncFileName()
  }

  if (isMobileSyncRemoteFile(trimmed)) {
    return trimmed
  }

  const baseName = trimmed.replace(/\.json$/i, '')
  const normalizedBaseName = baseName.startsWith('cherry-studio.')
    ? baseName.replace(/^cherry-studio\./, 'cherry-studio.mobile-sync.')
    : `cherry-studio.mobile-sync.${baseName}`

  return `${normalizedBaseName}.json`
}

export async function backupMobileSyncToWebDav(config: Partial<WebDavConfig>, customFileName?: string) {
  const normalized = validateConfig(config)
  await ensureBackupDirectoryExists(normalized)

  // Cloud mobile sync intentionally uploads the shared-data JSON directly so phone
  // and desktop exchange the same portable payload instead of treating WebDAV as
  // another full-backup transport with platform-specific restore behavior.
  const payload = await exportMobileSyncPayload()
  const fileName = normalizeMobileSyncWebDavFileName(customFileName)

  await webDavRequest(
    normalized,
    fileName,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: payload
    },
    [200, 201, 204]
  )

  return {
    fileName,
    size: Buffer.from(payload, 'utf8').byteLength,
    modifiedTime: new Date().toISOString()
  } satisfies WebDavRemoteFile
}

export async function downloadWebDavBackup(fileName: string, config: Partial<WebDavConfig>) {
  const normalized = validateConfig(config)

  if (!DEFAULT_BACKUP_STORAGE.exists) {
    DEFAULT_BACKUP_STORAGE.create({ intermediates: true, idempotent: true })
  }

  const localFileName = `webdav-${Date.now()}-${fileName}`
  const localFile = new File(DEFAULT_BACKUP_STORAGE, localFileName)

  if (localFile.exists) {
    localFile.delete()
  }

  const response = await webDavRequest(
    normalized,
    fileName,
    {
      method: 'GET'
    },
    [200]
  )

  const data = Buffer.from(await response.arrayBuffer())
  await LegacyFileSystem.writeAsStringAsync(localFile.uri, data.toString('base64'), {
    encoding: LegacyFileSystem.EncodingType.Base64
  })

  return {
    fileName,
    uri: localFile.uri,
    size: data.byteLength
  }
}

export async function downloadWebDavMobileSync(fileName: string, config: Partial<WebDavConfig>) {
  const normalized = validateConfig(config)
  const response = await webDavRequest(
    normalized,
    fileName,
    {
      method: 'GET'
    },
    [200]
  )

  return response.text()
}
