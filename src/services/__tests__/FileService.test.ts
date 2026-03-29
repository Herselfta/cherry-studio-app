const mockFiles = new Map<string, { size: number }>()
const mockDirectories = new Set<string>()
const mockCopyAsync = jest.fn(async ({ from, to }: { from: string; to: string }) => {
  const source = mockFiles.get(from)

  if (!source) {
    throw new Error(`Missing mock source file: ${from}`)
  }

  mockFiles.set(to, { size: source.size })
})

jest.mock('@database', () => ({
  fileDatabase: {
    getAllFiles: jest.fn(),
    getFileById: jest.fn()
  }
}))

jest.mock('expo-file-system', () => {
  const joinUriSegments = (...uris: unknown[]) => {
    const [first, ...rest] = uris.map(uri => (typeof uri === 'string' ? uri : (uri as { uri: string }).uri))

    return [first.replace(/\/+$/g, ''), ...rest.map(segment => segment.replace(/^\/+|\/+$/g, ''))].join('/')
  }

  class MockDirectory {
    uri: string

    constructor(...uris: unknown[]) {
      this.uri = joinUriSegments(...uris)
    }

    info() {
      return {
        exists: mockDirectories.has(this.uri)
      }
    }

    get exists() {
      return mockDirectories.has(this.uri)
    }

    create() {
      mockDirectories.add(this.uri)
    }

    delete() {
      mockDirectories.delete(this.uri)
    }

    list() {
      return []
    }
  }

  class MockFile {
    uri: string

    constructor(...uris: unknown[]) {
      this.uri = joinUriSegments(...uris)
    }

    info() {
      const file = mockFiles.get(this.uri)

      return {
        exists: Boolean(file),
        size: file?.size ?? null
      }
    }

    get exists() {
      return mockFiles.has(this.uri)
    }

    get size() {
      return mockFiles.get(this.uri)?.size ?? 0
    }

    delete() {
      mockFiles.delete(this.uri)
    }

    textSync() {
      return ''
    }

    base64Sync() {
      return ''
    }

    readableStream() {
      return new ReadableStream()
    }

    move() {}
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: {
      cache: 'file:///cache',
      document: 'file:///document'
    }
  }
})

jest.mock('expo-file-system/legacy', () => ({
  copyAsync: mockCopyAsync,
  writeAsStringAsync: jest.fn(),
  EncodingType: {
    UTF8: 'utf8',
    Base64: 'base64'
  }
}))

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn()
}))

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android'
  }
}))

jest.mock('@/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn()
    })
  }
}))

jest.mock('@/utils', () => ({
  uuid: jest.fn(() => 'mock-uuid')
}))

describe('FileService restore staging helpers', () => {
  beforeEach(() => {
    mockFiles.clear()
    mockDirectories.clear()
    mockCopyAsync.mockClear()
  })

  it('stages local restore inputs outside the cache reset scope', async () => {
    const { stageRestoreInputFile } = require('@/services/FileService')

    mockFiles.set('file:///cache/DocumentPicker/cherry-studio.backup.zip', { size: 128 })

    const staged = await stageRestoreInputFile({
      name: 'cherry-studio.backup.zip',
      uri: 'file:///cache/DocumentPicker/cherry-studio.backup.zip',
      size: 128
    })

    expect(mockCopyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/DocumentPicker/cherry-studio.backup.zip',
      to: 'file:///document/CherryStudioRestore/mock-uuid-cherry-studio.backup.zip'
    })
    expect(staged.uri).toBe('file:///document/CherryStudioRestore/mock-uuid-cherry-studio.backup.zip')
    expect(staged.size).toBe(128)
  })

  it('detects when restore inputs need staging before cache reset', () => {
    const { shouldStageRestoreInputFile } = require('@/services/FileService')

    expect(shouldStageRestoreInputFile('file:///cache/DocumentPicker/cherry-studio.backup.zip', true)).toBe(true)
    expect(shouldStageRestoreInputFile('content://com.android.providers.downloads/document/1', true)).toBe(true)
    expect(shouldStageRestoreInputFile('/storage/emulated/0/Download/cherry-studio.backup.zip', true)).toBe(true)
    expect(shouldStageRestoreInputFile('backup-20260329.zip', true)).toBe(false)
    expect(shouldStageRestoreInputFile('file:///cache/DocumentPicker/cherry-studio.backup.zip', false)).toBe(false)
  })

  it('cleans up staged restore inputs after restore finishes', () => {
    const { cleanupStagedRestoreInputFile } = require('@/services/FileService')

    mockFiles.set('file:///document/CherryStudioRestore/mock-uuid-cherry-studio.backup.zip', { size: 128 })

    cleanupStagedRestoreInputFile(
      'file:///document/CherryStudioRestore/mock-uuid-cherry-studio.backup.zip',
      'file:///cache/DocumentPicker/cherry-studio.backup.zip'
    )

    expect(mockFiles.has('file:///document/CherryStudioRestore/mock-uuid-cherry-studio.backup.zip')).toBe(false)
  })
})
