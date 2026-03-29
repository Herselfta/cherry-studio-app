import { loggerService } from '@/services/LoggerService'
import { storage, uuid } from '@/utils'

const logger = loggerService.withContext('MobileSyncLedger')

export const MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY = 'mobile_sync_source_device_id'
export const MOBILE_SYNC_LEDGER_STORAGE_KEY = 'mobile_sync_ledger_v2'
export const MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY = 'mobile_sync_global_ledger_v3'
export const MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY = 'mobile_sync_legacy_ledger_v1'

export type MobileSyncLedgerEntry = {
  lastImportedExportedAt: number
  topicIds: string[]
  messageIds: string[]
  blockIds: string[]
}

export type MobileSyncLedger = Record<string, MobileSyncLedgerEntry>
export type MobileSyncLegacyLedger = Record<string, MobileSyncLedgerEntry>
export type MobileSyncStorage = Pick<typeof storage, 'getString' | 'set' | 'delete'>

function normalizeLedgerEntry(entry: MobileSyncLedgerEntry): MobileSyncLedgerEntry {
  return {
    lastImportedExportedAt: entry.lastImportedExportedAt,
    topicIds: Array.from(new Set(entry.topicIds)),
    messageIds: Array.from(new Set(entry.messageIds)),
    blockIds: Array.from(new Set(entry.blockIds))
  }
}

export function getOrCreateMobileSyncSourceDeviceId(targetStorage: MobileSyncStorage = storage) {
  const existing = targetStorage.getString(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const deviceId = uuid()
  targetStorage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, deviceId)
  return deviceId
}

export function readMobileSyncLedger(targetStorage: MobileSyncStorage = storage): MobileSyncLedger {
  const serialized = targetStorage.getString(MOBILE_SYNC_LEDGER_STORAGE_KEY)
  if (!serialized) {
    return {}
  }

  try {
    return JSON.parse(serialized) as MobileSyncLedger
  } catch (error) {
    logger.warn('Failed to parse mobile sync ledger', error)
    return {}
  }
}

export function getMobileSyncLedgerEntry(
  sourceDeviceId: string,
  targetStorage: MobileSyncStorage = storage
): MobileSyncLedgerEntry | undefined {
  return readMobileSyncLedger(targetStorage)[sourceDeviceId]
}

export function writeMobileSyncLedgerEntry(
  sourceDeviceId: string,
  entry: MobileSyncLedgerEntry,
  targetStorage: MobileSyncStorage = storage
) {
  const ledger = readMobileSyncLedger(targetStorage)
  ledger[sourceDeviceId] = normalizeLedgerEntry(entry)
  targetStorage.set(MOBILE_SYNC_LEDGER_STORAGE_KEY, JSON.stringify(ledger))
}

export function getLatestMobileSyncLedgerEntry(
  targetStorage: MobileSyncStorage = storage
): MobileSyncLedgerEntry | undefined {
  const serialized = targetStorage.getString(MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY)
  if (!serialized) {
    return undefined
  }

  try {
    return normalizeLedgerEntry(JSON.parse(serialized) as MobileSyncLedgerEntry)
  } catch (error) {
    logger.warn('Failed to parse global mobile sync ledger', error)
    return undefined
  }
}

export function writeLatestMobileSyncLedgerEntry(
  entry: MobileSyncLedgerEntry,
  targetStorage: MobileSyncStorage = storage
) {
  targetStorage.set(MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY, JSON.stringify(normalizeLedgerEntry(entry)))
}

export function readLegacyMobileSyncLedger(targetStorage: MobileSyncStorage = storage): MobileSyncLegacyLedger {
  const serialized = targetStorage.getString(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY)
  if (!serialized) {
    return {}
  }

  try {
    return JSON.parse(serialized) as MobileSyncLegacyLedger
  } catch (error) {
    logger.warn('Failed to parse legacy mobile sync ledger', error)
    return {}
  }
}

export function getLegacyMobileSyncLedgerEntry(
  sourceKey: string,
  targetStorage: MobileSyncStorage = storage
): MobileSyncLedgerEntry | undefined {
  return readLegacyMobileSyncLedger(targetStorage)[sourceKey]
}

export function writeLegacyMobileSyncLedgerEntry(
  sourceKey: string,
  entry: MobileSyncLedgerEntry,
  targetStorage: MobileSyncStorage = storage
) {
  const ledger = readLegacyMobileSyncLedger(targetStorage)
  ledger[sourceKey] = normalizeLedgerEntry(entry)
  targetStorage.set(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY, JSON.stringify(ledger))
}

export function removeLegacyMobileSyncLedgerEntry(sourceKey: string, targetStorage: MobileSyncStorage = storage) {
  const ledger = readLegacyMobileSyncLedger(targetStorage)
  if (!(sourceKey in ledger)) {
    return
  }

  delete ledger[sourceKey]

  if (Object.keys(ledger).length === 0) {
    targetStorage.delete(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY)
    return
  }

  targetStorage.set(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY, JSON.stringify(ledger))
}
