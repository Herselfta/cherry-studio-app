jest.mock('@database', () => ({
  assistantDatabase: {},
  mcpDatabase: {},
  messageBlockDatabase: {},
  messageDatabase: {},
  providerDatabase: {},
  topicDatabase: {},
  websearchProviderDatabase: {}
}))

jest.mock('expo-file-system', () => ({
  Directory: class MockDirectory {},
  File: class MockFile {},
  Paths: {
    join: (...parts: string[]) => parts.join('/')
  }
}))

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(),
  zip: jest.fn()
}))

jest.mock('@/constants/storage', () => ({
  DEFAULT_BACKUP_STORAGE: {
    exists: true,
    create: jest.fn()
  },
  DEFAULT_DOCUMENTS_STORAGE: {
    exists: true,
    create: jest.fn()
  }
}))

jest.mock('@/config/assistants', () => ({
  getSystemAssistants: jest.fn(() => [])
}))

jest.mock('@/services/AppInitializationService', () => ({
  resetAppInitializationState: jest.fn(),
  runAppDataMigrations: jest.fn()
}))

jest.mock('@/services/AssistantService', () => ({
  assistantService: {}
}))

jest.mock('@/services/PreferenceService', () => ({
  preferenceService: {}
}))

jest.mock('@/services/ProviderService', () => ({
  providerService: {}
}))

jest.mock('@/services/TopicService', () => ({
  topicService: {}
}))

const { getThemeModeFromBackupSettings, transformBackupData } = require('@/services/BackupService')

describe('BackupService.transformBackupData', () => {
  it('reads WebDAV config and theme from desktop backup settings', () => {
    const backupData = JSON.stringify({
      localStorage: {
        'persist:cherry-studio': JSON.stringify({
          assistants: JSON.stringify({
            defaultAssistant: { id: 'default', topics: [] },
            assistants: []
          }),
          llm: JSON.stringify({ providers: [] }),
          websearch: JSON.stringify({ providers: [] }),
          settings: JSON.stringify({
            userName: 'Desktop User',
            theme: 'dark',
            webdavHost: 'https://dav.example.com/',
            webdavUser: 'desktop-user',
            webdavPass: 'desktop-pass',
            webdavPath: '/desktop-backups'
          })
        })
      },
      indexedDB: {
        topics: [],
        message_blocks: [],
        settings: []
      }
    })

    const parsed = transformBackupData(backupData)

    expect(parsed.webDavConfig).toEqual({
      host: 'https://dav.example.com/',
      user: 'desktop-user',
      password: 'desktop-pass',
      path: '/desktop-backups'
    })
    expect(parsed.reduxData.settings.theme).toBe('dark')
  })
})

describe('BackupService.getThemeModeFromBackupSettings', () => {
  it('returns a valid portable theme mode from backup settings', () => {
    expect(
      getThemeModeFromBackupSettings({
        userName: 'Cherry Studio',
        theme: 'dark'
      })
    ).toBe('dark')
  })

  it('ignores invalid desktop-only theme values', () => {
    expect(
      getThemeModeFromBackupSettings({
        userName: 'Cherry Studio',
        theme: 'amoled'
      })
    ).toBeUndefined()
  })
})
