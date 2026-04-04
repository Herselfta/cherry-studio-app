import { storage } from '@/utils'

import { createEmptyMobileOnlineSyncState, type MobileOnlineSyncTrackerState } from './mobileOnlineSyncProtocol'
import { getOrCreateMobileSyncSourceDeviceId } from './mobileSyncLedger'

const MOBILE_ONLINE_SYNC_STATE_STORAGE_KEY = 'mobile_online_sync_state_v1'
const MOBILE_ONLINE_SYNC_CONFIG_STORAGE_KEY = 'mobile_online_sync_config_v1'

export type MobileOnlineSyncConfig = {
  baseUrl: string
  authToken: string
}

export function readMobileOnlineSyncState(): MobileOnlineSyncTrackerState {
  const serialized = storage.getString(MOBILE_ONLINE_SYNC_STATE_STORAGE_KEY)
  const replicaId = getOrCreateMobileSyncSourceDeviceId()

  if (!serialized) {
    return createEmptyMobileOnlineSyncState(replicaId)
  }

  try {
    return JSON.parse(serialized) as MobileOnlineSyncTrackerState
  } catch {
    return createEmptyMobileOnlineSyncState(replicaId)
  }
}

export function writeMobileOnlineSyncState(state: MobileOnlineSyncTrackerState) {
  storage.set(MOBILE_ONLINE_SYNC_STATE_STORAGE_KEY, JSON.stringify(state))
}

export function readMobileOnlineSyncConfig(): MobileOnlineSyncConfig | null {
  const serialized = storage.getString(MOBILE_ONLINE_SYNC_CONFIG_STORAGE_KEY)
  if (!serialized) {
    return null
  }

  try {
    return JSON.parse(serialized) as MobileOnlineSyncConfig
  } catch {
    return null
  }
}

export function writeMobileOnlineSyncConfig(config: MobileOnlineSyncConfig) {
  storage.set(MOBILE_ONLINE_SYNC_CONFIG_STORAGE_KEY, JSON.stringify(config))
}

export function clearMobileOnlineSyncConfig() {
  storage.delete(MOBILE_ONLINE_SYNC_CONFIG_STORAGE_KEY)
}
