const mockReloadAppAsync = jest.fn()
const mockUpdatesReloadAsync = jest.fn()
const mockDevSettingsReload = jest.fn()
const mockKeyboardDismiss = jest.fn()
const mockRunAfterInteractions = jest.fn((callback: () => void) => {
  callback()
  return { cancel: jest.fn() }
})
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn()
}
const mockPlatform = { OS: 'android' }
const mockUpdatesModule = {
  isEnabled: true,
  reloadAsync: (...args: unknown[]) => mockUpdatesReloadAsync(...args)
}

jest.mock('expo', () => ({
  reloadAppAsync: (...args: unknown[]) => mockReloadAppAsync(...args)
}))

jest.mock('expo-updates', () => mockUpdatesModule)

jest.mock('react-native', () => ({
  DevSettings: {
    reload: (...args: unknown[]) => mockDevSettingsReload(...args)
  },
  InteractionManager: {
    runAfterInteractions: (...args: Parameters<typeof mockRunAfterInteractions>) => mockRunAfterInteractions(...args)
  },
  Keyboard: {
    dismiss: (...args: unknown[]) => mockKeyboardDismiss(...args)
  },
  Platform: mockPlatform
}))

jest.mock('@/services/LoggerService', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

const { reloadApplication } = require('@/services/AppReloadService')

describe('AppReloadService', () => {
  const originalDev = __DEV__

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    mockPlatform.OS = 'android'
    mockUpdatesModule.isEnabled = true
    mockReloadAppAsync.mockResolvedValue(undefined)
    mockUpdatesReloadAsync.mockResolvedValue(undefined)
    mockDevSettingsReload.mockImplementation(() => undefined)
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: false
    })
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: originalDev
    })
  })

  it('waits for UI to settle and prefers reloadAppAsync before expo-updates', async () => {
    const reloadPromise = reloadApplication()

    await jest.advanceTimersByTimeAsync(300)
    await reloadPromise

    expect(mockKeyboardDismiss).toHaveBeenCalledTimes(1)
    expect(mockRunAfterInteractions).toHaveBeenCalledTimes(1)
    expect(mockReloadAppAsync).toHaveBeenCalledWith('Reloading after local data restore')
    expect(mockUpdatesReloadAsync).not.toHaveBeenCalled()
  })

  it('falls back to DevSettings in development when reloadAppAsync fails', async () => {
    mockReloadAppAsync.mockRejectedValueOnce(new Error('reloadAppAsync failed'))
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: true
    })

    const reloadPromise = reloadApplication()

    await jest.advanceTimersByTimeAsync(300)
    await reloadPromise

    expect(mockDevSettingsReload).toHaveBeenCalledTimes(1)
    expect(mockUpdatesReloadAsync).not.toHaveBeenCalled()
  })

  it('falls back to expo-updates when other reload paths fail', async () => {
    mockReloadAppAsync.mockRejectedValueOnce(new Error('reloadAppAsync failed'))
    mockDevSettingsReload.mockImplementationOnce(() => {
      throw new Error('DevSettings failed')
    })
    Object.defineProperty(global, '__DEV__', {
      configurable: true,
      value: true
    })

    const reloadPromise = reloadApplication()

    await jest.advanceTimersByTimeAsync(300)
    await reloadPromise

    expect(mockDevSettingsReload).toHaveBeenCalledTimes(1)
    expect(mockUpdatesReloadAsync).toHaveBeenCalledTimes(1)
  })
})
