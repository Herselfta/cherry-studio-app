const mockStorageState = new Map<string, string>()

jest.mock('@/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      warn: jest.fn()
    })
  }
}))

jest.mock('@/utils', () => ({
  uuid: () => 'device-uuid',
  storage: {
    getString: (key: string) => mockStorageState.get(key),
    set: (key: string, value: string) => {
      mockStorageState.set(key, value)
    },
    delete: (key: string) => {
      mockStorageState.delete(key)
    }
  }
}))

const {
  getLatestMobileSyncLedgerEntry,
  getMobileSyncLedgerEntry,
  MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY,
  MOBILE_SYNC_LEDGER_STORAGE_KEY,
  writeLatestMobileSyncLedgerEntry,
  writeMobileSyncLedgerEntry
} = require('@/services/mobileSyncLedger')

describe('mobileSyncLedger', () => {
  beforeEach(() => {
    mockStorageState.clear()
  })

  it('stores the latest imported portable snapshot globally instead of only per source device', () => {
    writeMobileSyncLedgerEntry('device-a', {
      lastImportedExportedAt: 10,
      topicIds: ['topic-a'],
      messageIds: ['message-a'],
      blockIds: ['block-a']
    })
    writeLatestMobileSyncLedgerEntry({
      lastImportedExportedAt: 20,
      topicIds: ['topic-b'],
      messageIds: ['message-b'],
      blockIds: ['block-b']
    })

    expect(getMobileSyncLedgerEntry('device-a')).toEqual(
      expect.objectContaining({
        lastImportedExportedAt: 10,
        topicIds: ['topic-a']
      })
    )
    expect(getLatestMobileSyncLedgerEntry()).toEqual(
      expect.objectContaining({
        lastImportedExportedAt: 20,
        topicIds: ['topic-b'],
        messageIds: ['message-b'],
        blockIds: ['block-b']
      })
    )
    expect(mockStorageState.get(MOBILE_SYNC_LEDGER_STORAGE_KEY)).toContain('device-a')
    expect(mockStorageState.get(MOBILE_SYNC_GLOBAL_LEDGER_STORAGE_KEY)).toContain('topic-b')
  })
})
