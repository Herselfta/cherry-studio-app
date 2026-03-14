jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string
    size = 0
    exists = false

    constructor(...parts: string[]) {
      this.uri = parts.join('/')
    }

    async bytes() {
      return new Uint8Array()
    }

    delete() {}
  }
}))

jest.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: jest.fn(),
  EncodingType: {
    Base64: 'base64'
  }
}))

jest.mock('@/constants/storage', () => ({
  DEFAULT_BACKUP_STORAGE: {
    exists: true,
    create: jest.fn(),
    uri: 'file:///mock/backups/'
  }
}))

jest.mock('@/services/BackupService', () => ({
  backup: jest.fn()
}))

const {
  DEFAULT_WEBDAV_PATH,
  getWebDavConfig,
  normalizeWebDavConfig,
  normalizeWebDavPath,
  parseWebDavBackupFiles,
  saveWebDavConfig
} = require('@/services/WebDavService')

describe('WebDavService', () => {
  beforeEach(() => {
    global.__mockStorageData?.clear()
  })

  it('normalizes path with a default value', () => {
    expect(normalizeWebDavPath('')).toBe(DEFAULT_WEBDAV_PATH)
    expect(normalizeWebDavPath('/')).toBe('/')
    expect(normalizeWebDavPath('///mobile/backups//')).toBe('/mobile/backups')
  })

  it('normalizes config before saving', () => {
    const config = saveWebDavConfig({
      host: ' https://dav.example.com/ ',
      user: ' demo ',
      password: 'secret',
      path: ' backups/mobile '
    })

    expect(config).toEqual({
      host: 'https://dav.example.com/',
      user: 'demo',
      password: 'secret',
      path: '/backups/mobile'
    })
    expect(getWebDavConfig()).toEqual(config)
  })

  it('falls back to defaults for invalid stored config', () => {
    global.__mockStorageData?.set('webdav_config_v1', '{invalid-json')

    expect(getWebDavConfig()).toEqual(
      normalizeWebDavConfig({
        host: '',
        user: '',
        password: '',
        path: DEFAULT_WEBDAV_PATH
      })
    )
  })

  it('parses only zip files from a PROPFIND response', () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/CherryStudio/</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:displayname>CherryStudio</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/CherryStudio/cherry-studio.202603141230.zip</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:displayname>cherry-studio.202603141230.zip</d:displayname>
        <d:getcontentlength>1024</d:getcontentlength>
        <d:getlastmodified>Fri, 14 Mar 2026 12:30:00 GMT</d:getlastmodified>
        <d:resourcetype />
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/CherryStudio/readme.txt</d:href>
    <d:propstat>
      <d:status>HTTP/1.1 200 OK</d:status>
      <d:prop>
        <d:displayname>readme.txt</d:displayname>
        <d:getcontentlength>12</d:getcontentlength>
        <d:getlastmodified>Fri, 14 Mar 2026 11:00:00 GMT</d:getlastmodified>
        <d:resourcetype />
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`

    expect(parseWebDavBackupFiles(xml)).toEqual([
      {
        fileName: 'cherry-studio.202603141230.zip',
        size: 1024,
        modifiedTime: 'Fri, 14 Mar 2026 12:30:00 GMT'
      }
    ])
  })
})
