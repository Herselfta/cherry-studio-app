const {
  DEFAULT_WEBDAV_PATH,
  getWebDavBackupSettings,
  getWebDavConfigFromBackup,
  normalizeWebDavConfig
} = require('@/services/WebDavConfigService')

describe('WebDavConfigService', () => {
  it('extracts WebDAV config from desktop backup settings', () => {
    expect(
      getWebDavConfigFromBackup({
        settings: {
          webdavHost: 'https://dav.example.com/',
          webdavUser: 'desktop-user',
          webdavPass: 'desktop-pass',
          webdavPath: '/desktop-backups'
        }
      })
    ).toEqual(
      normalizeWebDavConfig({
        host: 'https://dav.example.com/',
        user: 'desktop-user',
        password: 'desktop-pass',
        path: '/desktop-backups'
      })
    )
  })

  it('prefers app local WebDAV config when backup stores both formats', () => {
    expect(
      getWebDavConfigFromBackup({
        localStorage: {
          webdav_config_v1: JSON.stringify({
            host: 'https://mobile.example.com/',
            user: 'mobile-user',
            password: 'mobile-pass',
            path: '/mobile'
          })
        },
        settings: {
          webdavHost: 'https://desktop.example.com/',
          webdavUser: 'desktop-user',
          webdavPass: 'desktop-pass',
          webdavPath: '/desktop'
        }
      })
    ).toEqual(
      normalizeWebDavConfig({
        host: 'https://mobile.example.com/',
        user: 'mobile-user',
        password: 'mobile-pass',
        path: '/mobile'
      })
    )
  })

  it('builds desktop-compatible backup settings from app config', () => {
    expect(
      getWebDavBackupSettings({
        host: 'https://dav.example.com/',
        user: 'demo',
        password: 'secret',
        path: ''
      })
    ).toEqual({
      webdavHost: 'https://dav.example.com/',
      webdavUser: 'demo',
      webdavPass: 'secret',
      webdavPath: DEFAULT_WEBDAV_PATH
    })
  })
})
