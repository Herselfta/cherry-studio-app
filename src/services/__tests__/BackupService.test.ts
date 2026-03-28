jest.mock('@database', () => ({
  assistantDatabase: {},
  fileDatabase: {
    upsertFiles: jest.fn()
  },
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

jest.mock('@/services/FileService', () => ({
  writeBase64File: jest.fn()
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
  materializePortableImageBlocks,
  normalizeAssistantsFromBackup,
  transformBackupData
} = require('@/services/BackupService')
const { fileDatabase } = require('@database')
const { writeBase64File } = require('@/services/FileService')

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

  it('ignores desktop-only local backup settings from migration payloads', () => {
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
            localBackupDir: '/Users/mac/Backups',
            localBackupAutoSync: true,
            localBackupSyncInterval: 30,
            localBackupMaxBackups: 5,
            localBackupSkipBackupFile: false
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

    expect(parsed.reduxData.settings).toMatchObject({
      userName: 'Desktop User',
      theme: 'dark'
    })
    expect((parsed.reduxData.settings as Record<string, unknown>).localBackupDir).toBeUndefined()
    expect((parsed.reduxData.settings as Record<string, unknown>).localBackupAutoSync).toBeUndefined()
  })

  it('normalizes portable language from desktop migration localStorage', () => {
    const backupData = JSON.stringify({
      localStorage: {
        language: 'zh-CN',
        'persist:cherry-studio': JSON.stringify({
          assistants: JSON.stringify({
            defaultAssistant: { id: 'default', topics: [] },
            assistants: []
          }),
          llm: JSON.stringify({ providers: [] }),
          websearch: JSON.stringify({ providers: [] }),
          settings: JSON.stringify({
            userName: 'Desktop User',
            theme: 'dark'
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

    expect(parsed.portableLanguage).toBe('zh-Hans-CN')
  })

  it('falls back to desktop settings.language when migration localStorage has no language key', () => {
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
            language: 'zh-CN'
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

    expect(parsed.portableLanguage).toBe('zh-Hans-CN')
  })

  it('extracts portable image assets from desktop migration payloads', () => {
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
            theme: 'dark'
          })
        })
      },
      indexedDB: {
        topics: [],
        message_blocks: [],
        settings: []
      },
      portableImageAssets: [
        {
          fileId: 'image-1',
          data: 'data:image/png;base64,abc123',
          ext: '.png',
          name: 'image-1',
          origin_name: 'shared-image.png'
        }
      ]
    })

    const parsed = transformBackupData(backupData)

    expect(parsed.portableImageAssets).toEqual([
      expect.objectContaining({
        fileId: 'image-1',
        data: 'data:image/png;base64,abc123',
        ext: '.png',
        origin_name: 'shared-image.png'
      })
    ])
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

  it('restores desktop default assistant while seeding missing mobile-only system assistants', () => {
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
        }
      ]
    })

    expect(normalized.source).toBe('desktop-migration')
    expect(normalized.systemAssistants.find(assistant => assistant.id === 'default')).toEqual(
      expect.objectContaining({ id: 'default', name: 'Desktop Custom Default', emoji: '🤖' })
    )
    expect(normalized.systemAssistants.find(assistant => assistant.id === 'quick')).toEqual(
      expect.objectContaining({ id: 'quick', name: 'Mobile Quick', emoji: '🏷️' })
    )
    expect(normalized.systemAssistants.find(assistant => assistant.id === 'translate')).toEqual(
      expect.objectContaining({ id: 'translate', name: 'Mobile Translate', emoji: '🌐' })
    )
  })

  it('keeps the default assistant runtime model separate from the global default model', () => {
    const desktopGlobalDefaultModel = {
      id: 'desktop-default-model',
      provider: 'openai',
      name: 'Desktop Default Model',
      group: 'default'
    }
    const desktopDefaultAssistantModel = {
      id: 'desktop-default-assistant-model',
      provider: 'openrouter',
      name: 'Desktop Default Assistant Runtime Model',
      group: 'assistant'
    }
    const desktopQuickModel = {
      id: 'desktop-quick-model',
      provider: 'anthropic',
      name: 'Desktop Quick Model',
      group: 'quick'
    }
    const desktopTranslateModel = {
      id: 'desktop-translate-model',
      provider: 'google',
      name: 'Desktop Translate Model',
      group: 'translate'
    }
    const desktopTopicNamingModel = {
      id: 'desktop-topic-naming-model',
      provider: 'openrouter',
      name: 'Desktop Topic Naming Model',
      group: 'topicNaming'
    }

    const normalized = normalizeAssistantsFromBackup(
      {
        defaultAssistant: {
          id: 'default',
          name: 'Desktop Default Assistant',
          emoji: '🤖',
          model: desktopDefaultAssistantModel,
          defaultModel: desktopDefaultAssistantModel,
          prompt: '',
          topics: [],
          type: 'assistant'
        },
        assistants: []
      },
      {
        providers: [],
        defaultModel: desktopGlobalDefaultModel,
        quickModel: desktopQuickModel,
        translateModel: desktopTranslateModel,
        topicNamingModel: desktopTopicNamingModel
      }
    )

    expect(normalized.globalDefaultModel).toEqual(desktopGlobalDefaultModel)
    expect(normalized.systemAssistants.find(assistant => assistant.id === 'default')).toEqual(
      expect.objectContaining({
        defaultModel: desktopDefaultAssistantModel,
        model: desktopDefaultAssistantModel
      })
    )
    expect(normalized.systemAssistants.find(assistant => assistant.id === 'quick')).toEqual(
      expect.objectContaining({
        defaultModel: desktopQuickModel,
        model: desktopQuickModel
      })
    )
    expect(normalized.systemAssistants.find(assistant => assistant.id === 'translate')).toEqual(
      expect.objectContaining({
        defaultModel: desktopTranslateModel,
        model: desktopTranslateModel
      })
    )
  })

  it('falls back to desktop topicNamingModel for quick assistant when old migrations lack quickModel', () => {
    const desktopTopicNamingModel = {
      id: 'desktop-topic-naming-model',
      provider: 'openrouter',
      name: 'Desktop Topic Naming Model',
      group: 'topicNaming'
    }

    const normalized = normalizeAssistantsFromBackup(
      {
        defaultAssistant: {
          id: 'default',
          name: 'Desktop Default Assistant',
          emoji: '🤖',
          prompt: '',
          topics: [],
          type: 'assistant'
        },
        assistants: []
      },
      {
        providers: [],
        topicNamingModel: desktopTopicNamingModel
      }
    )

    expect(normalized.systemAssistants.find(assistant => assistant.id === 'quick')).toEqual(
      expect.objectContaining({
        defaultModel: desktopTopicNamingModel,
        model: desktopTopicNamingModel
      })
    )
  })

  it('materializes desktop agent presets as external assistants and preserves avatar metadata', () => {
    const normalized = normalizeAssistantsFromBackup({
      defaultAssistant: {
        id: 'default',
        name: 'Desktop Default',
        emoji: '🙂',
        prompt: '',
        topics: [],
        type: 'assistant'
      },
      assistants: [
        {
          id: 'agent-preset',
          name: 'Desktop Agent',
          prompt: 'preset prompt',
          topics: [],
          type: 'external'
        }
      ],
      presets: [
        {
          id: 'agent-preset',
          name: 'Desktop Agent',
          avatar: 'data:image/png;base64,agent-avatar',
          prompt: 'preset prompt',
          topics: [],
          type: 'agent'
        }
      ]
    })

    expect(normalized.externalAssistants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-preset',
          name: 'Desktop Agent',
          avatar: 'data:image/png;base64,agent-avatar',
          type: 'external'
        })
      ])
    )
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

describe('BackupService.materializePortableImageBlocks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rewrites desktop image file references into local mobile files', async () => {
    writeBase64File.mockResolvedValue({
      id: 'image-1',
      name: 'image-1',
      origin_name: 'shared-image.png',
      path: 'file:///data/user/0/app/files/Images/image-1.png',
      size: 12,
      ext: '.png',
      type: 'image',
      created_at: 1,
      count: 1
    })

    const restoredBlocks = await materializePortableImageBlocks(
      [
        {
          id: 'block-1',
          messageId: 'message-1',
          type: 'image',
          createdAt: 1,
          status: 'success',
          file: {
            id: 'image-1',
            name: 'image-1',
            origin_name: 'shared-image.png',
            path: '/Users/mac/shared-image.png',
            size: 12,
            ext: '.png',
            type: 'image',
            created_at: 1,
            count: 1
          }
        }
      ],
      [
        {
          fileId: 'image-1',
          data: 'data:image/png;base64,abc123',
          ext: '.png',
          name: 'image-1',
          origin_name: 'shared-image.png'
        }
      ]
    )

    expect(writeBase64File).toHaveBeenCalledWith(
      'data:image/png;base64,abc123',
      expect.objectContaining({
        fileId: 'image-1',
        extension: '.png',
        originName: 'shared-image.png'
      })
    )
    expect(fileDatabase.upsertFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'image-1',
        path: 'file:///data/user/0/app/files/Images/image-1.png'
      })
    ])
    expect(restoredBlocks).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({
          id: 'image-1',
          path: 'file:///data/user/0/app/files/Images/image-1.png'
        })
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
