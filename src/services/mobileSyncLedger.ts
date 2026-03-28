import { loggerService } from '@/services/LoggerService'
import { storage, uuid } from '@/utils'

const logger = loggerService.withContext('MobileSyncLedger')

export const MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY = 'mobile_sync_source_device_id'
export const MOBILE_SYNC_LEDGER_STORAGE_KEY = 'mobile_sync_ledger_v2'
export const MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY = 'mobile_sync_legacy_ledger_v1'

export type MobileSyncLedgerEntry = {
  lastImportedExportedAt: number
  topicIds: string[]
  messageIds: string[]
  blockIds: string[]
}

export type MobileSyncLedger = Record<string, MobileSyncLedgerEntry>
export type MobileSyncLegacyLedger = Record<string, MobileSyncLedgerEntry>

function normalizeLedgerEntry(entry: MobileSyncLedgerEntry): MobileSyncLedgerEntry {
  return {
    lastImportedExportedAt: entry.lastImportedExportedAt,
    topicIds: Array.from(new Set(entry.topicIds)),
    messageIds: Array.from(new Set(entry.messageIds)),
    blockIds: Array.from(new Set(entry.blockIds))
  }
}

export function getOrCreateMobileSyncSourceDeviceId() {
  const existing = storage.getString(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const deviceId = uuid()
  storage.set(MOBILE_SYNC_SOURCE_DEVICE_ID_STORAGE_KEY, deviceId)
  return deviceId
}

export function readMobileSyncLedger(): MobileSyncLedger {
  const serialized = storage.getString(MOBILE_SYNC_LEDGER_STORAGE_KEY)
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

export function getMobileSyncLedgerEntry(sourceDeviceId: string): MobileSyncLedgerEntry | undefined {
  return readMobileSyncLedger()[sourceDeviceId]
}

export function writeMobileSyncLedgerEntry(sourceDeviceId: string, entry: MobileSyncLedgerEntry) {
  const ledger = readMobileSyncLedger()
  ledger[sourceDeviceId] = normalizeLedgerEntry(entry)
  storage.set(MOBILE_SYNC_LEDGER_STORAGE_KEY, JSON.stringify(ledger))
}

export function readLegacyMobileSyncLedger(): MobileSyncLegacyLedger {
  const serialized = storage.getString(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY)
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

export function getLegacyMobileSyncLedgerEntry(sourceKey: string): MobileSyncLedgerEntry | undefined {
  return readLegacyMobileSyncLedger()[sourceKey]
}

export function writeLegacyMobileSyncLedgerEntry(sourceKey: string, entry: MobileSyncLedgerEntry) {
  const ledger = readLegacyMobileSyncLedger()
  ledger[sourceKey] = normalizeLedgerEntry(entry)
  storage.set(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY, JSON.stringify(ledger))
}

export function removeLegacyMobileSyncLedgerEntry(sourceKey: string) {
  const ledger = readLegacyMobileSyncLedger()
  if (!(sourceKey in ledger)) {
    return
  }

  delete ledger[sourceKey]

  if (Object.keys(ledger).length === 0) {
    storage.delete(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY)
    return
  }

  storage.set(MOBILE_SYNC_LEGACY_LEDGER_STORAGE_KEY, JSON.stringify(ledger))
}
