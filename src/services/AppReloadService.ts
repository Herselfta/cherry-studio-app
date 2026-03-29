import { reloadAppAsync } from 'expo'
import * as Updates from 'expo-updates'
import { DevSettings, InteractionManager, Keyboard, Platform } from 'react-native'

import { loggerService } from '@/services/LoggerService'

const logger = loggerService.withContext('AppReloadService')
const ANDROID_RELOAD_SETTLE_DELAY_MS = 300

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const waitForInteractions = () =>
  new Promise<void>(resolve => {
    InteractionManager.runAfterInteractions(() => resolve())
  })

async function settleBeforeReload(): Promise<void> {
  Keyboard.dismiss()
  await waitForInteractions()

  // Android can still be dispatching IME/key events when the restore modal closes.
  if (Platform.OS === 'android') {
    await delay(ANDROID_RELOAD_SETTLE_DELAY_MS)
  }
}

export async function reloadApplication(): Promise<void> {
  await settleBeforeReload()

  try {
    logger.info('Reloading application via expo reloadAppAsync')
    await reloadAppAsync('Reloading after local data restore')
    return
  } catch (error) {
    logger.warn('Failed to reload application via expo reloadAppAsync, falling back', error as Error)
  }

  if (__DEV__ && typeof DevSettings.reload === 'function') {
    try {
      logger.info('Reloading application via DevSettings')
      DevSettings.reload()
      return
    } catch (error) {
      logger.warn('Failed to reload application via DevSettings, falling back', error as Error)
    }
  }

  if (Updates.isEnabled) {
    try {
      logger.info('Reloading application via expo-updates')
      await Updates.reloadAsync()
      return
    } catch (error) {
      logger.warn('Failed to reload application via expo-updates, falling back', error as Error)
    }
  }

  throw new Error('Unable to reload application')
}
