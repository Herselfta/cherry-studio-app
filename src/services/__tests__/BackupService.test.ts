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
  getSystemAssistants: jest.fn(() => [
    { id: 'default', name: 'Mobile Default', emoji: '😀', prompt: '', topics: [], type: 'system' },
    { id: 'quick', name: 'Mobile Quick', emoji: '🏷️', prompt: '', topics: [], type: 'system' },
    { id: 'translate', name: 'Mobile Translate', emoji: '🌐', prompt: '', topics: [], type: 'system' }
  ])
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

const {
  getThemeModeFromBackupSettings,
  normalizeAssistantsFromBackup,
  transformBackupData
} = require('@/services/BackupService')

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

  it('prefers desktop default assistant payload over seeded mobile default when restoring migration backups', () => {
    const normalized = normalizeAssistantsFromBackup({
      defaultAssistant: {
        id: 'default',
        name: 'Desktop Fallback',
        emoji: '🙂',
        prompt: '',
        topics: [],
        type: 'assistant'
      },
      assistants: [
        {
          id: 'default',
          name: 'Desktop Custom Default',
          emoji: '🤖',
          prompt: '',
          topics: [],
          type: 'assistant'
        },
        {
          id: 'external-1',
          name: 'External Assistant',
          emoji: '🧪',
          prompt: '',
          topics: [],
          type: 'external'
        }
      ]
    })

    expect(normalized.source).toBe('desktop-migration')
    expect(normalized.systemAssistants.find(assistant => assistant.id === 'default')).toEqual(
      expect.objectContaining({
        name: 'Desktop Custom Default',
        emoji: '🤖',
        type: 'system'
      })
    )
    expect(normalized.externalAssistants).toEqual([
      expect.objectContaining({
        id: 'external-1',
        name: 'External Assistant',
        emoji: '🧪',
        type: 'external'
      })
    ])
  })

  it('keeps system assistant topic metadata when backup includes systemAssistants', () => {
    const backupData = JSON.stringify({
      localStorage: {
        'persist:cherry-studio': JSON.stringify({
          assistants: JSON.stringify({
            defaultAssistant: { id: 'default', topics: [] },
            systemAssistants: [
              { id: 'default', topics: [] },
              {
                id: 'quick',
                topics: [
                  {
                    id: 'topic-quick',
                    assistantId: 'quick',
                    name: 'Quick Topic',
                    createdAt: 1,
                    updatedAt: 2
                  }
                ]
              },
              { id: 'translate', topics: [] }
            ],
            assistants: []
          }),
          llm: JSON.stringify({ providers: [] }),
          websearch: JSON.stringify({ providers: [] }),
          settings: JSON.stringify({
            userName: 'Mobile User',
            theme: 'dark'
          })
        })
      },
      indexedDB: {
        topics: [
          {
            id: 'topic-quick',
            messages: []
          }
        ],
        message_blocks: [],
        settings: []
      }
    })

    const parsed = transformBackupData(backupData)

    expect(parsed.indexedData.topics).toEqual([
      expect.objectContaining({
        id: 'topic-quick',
        assistantId: 'quick',
        name: 'Quick Topic'
      })
    ])
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
