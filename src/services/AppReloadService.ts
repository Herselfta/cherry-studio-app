import { reloadAppAsync } from 'expo'
import * as Updates from 'expo-updates'
import { DevSettings } from 'react-native'

import { loggerService } from '@/services/LoggerService'

const logger = loggerService.withContext('AppReloadService')

export async function reloadApplication(): Promise<void> {
  if (Updates.isEnabled) {
    try {
      logger.info('Reloading application via expo-updates')
      await Updates.reloadAsync()
      return
    } catch (error) {
      logger.warn('Failed to reload application via expo-updates, falling back', error as Error)
    }
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

  logger.info('Reloading application via expo reloadAppAsync fallback')
  await reloadAppAsync()
}
