import { databaseMaintenance } from '@database'
import { useNavigation } from '@react-navigation/native'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as IntentLauncher from 'expo-intent-launcher'
import { delay } from 'lodash'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InteractionManager, Platform } from 'react-native'

import {
  Container,
  dismissDialog,
  Group,
  GroupTitle,
  HeaderBar,
  presentDialog,
  PressableRow,
  RestoreProgressModal,
  RowRightArrow,
  SafeAreaContainer,
  Text,
  XStack,
  YStack
} from '@/componentsV2'
import { FileText, Folder, FolderOpen, RotateCcw, Save, Trash2 } from '@/componentsV2/icons/LucideIcon'
import { DEFAULT_RESTORE_STEPS, useRestore } from '@/hooks/useRestore'
import { reloadApplication } from '@/services/AppReloadService'
import { backup } from '@/services/BackupService'
import { getCacheDirectorySize, resetCacheDirectory, saveFileToFolder, saveTextAsFile } from '@/services/FileService'
import { loggerService } from '@/services/LoggerService'
import { exportMobileSyncPayload, importMobileSyncPayload } from '@/services/MobileSyncService'
import { persistor } from '@/store'
import type { NavigationProps } from '@/types/naviagate'
import { formatFileSize } from '@/utils/file'
const logger = loggerService.withContext('BasicDataSettingsScreen')

interface SettingItemConfig {
  id: string
  title: string
  screen?: string
  icon: React.ReactElement
  subtitle?: string
  danger?: boolean
  onPress?: () => void
  disabled?: boolean
}

interface SettingGroupConfig {
  id: string
  title: string
  items: SettingItemConfig[]
}

export default function BasicDataSettingsScreen() {
  const { t } = useTranslation()
  const [isResetting, setIsResetting] = useState(false)
  const [isBackup, setIsBackup] = useState(false)
  const [cacheSize, setCacheSize] = useState<string>('--')
  const { isModalOpen, restoreSteps, overallStatus, startRestore, closeModal } = useRestore({
    stepConfigs: DEFAULT_RESTORE_STEPS,
    clearBeforeRestore: true
  })
  const {
    isModalOpen: isMobileSyncModalOpen,
    restoreSteps: mobileSyncRestoreSteps,
    overallStatus: mobileSyncOverallStatus,
    startRestore: startMobileSyncRestore,
    closeModal: closeMobileSyncModal
  } = useRestore({
    stepConfigs: DEFAULT_RESTORE_STEPS,
    clearBeforeRestore: false,
    customRestoreFunction: async (file, onProgress, dispatch) => {
      const payload = await new File(file.path).text()
      await importMobileSyncPayload(payload, onProgress, dispatch)
    }
  })

  const handleRestoreClose = () => {
    closeModal()
    if (overallStatus === 'success') {
      // 恢复成功后重启应用，与重置数据行为一致
      delay(() => {
        void reloadApplication()
      }, 200)
    }
  }

  const handleMobileSyncClose = () => {
    closeMobileSyncModal()
    if (mobileSyncOverallStatus === 'success') {
      delay(() => {
        void reloadApplication()
      }, 200)
    }
  }

  const loadCacheSize = async () => {
    try {
      const size = await getCacheDirectorySize()
      setCacheSize(formatFileSize(size))
    } catch (error) {
      logger.error('loadCacheSize', error as Error)
      setCacheSize('--')
    }
  }

  useEffect(() => {
    loadCacheSize()
  }, [isBackup])

  const handleBackup = async () => {
    try {
      setIsBackup(true)
      const backupUri = await backup()
      setIsBackup(false)

      const fileName = backupUri.split('/').pop() || `cherry-studio.${Date.now()}.zip`
      await saveFileToFolder(backupUri, fileName, 'application/zip')
    } catch (error) {
      logger.error('handleBackup', error as Error)
    }
  }

  const handleRestore = () => {
    presentDialog('warning', {
      title: t('settings.data.restore.title'),
      content: t('settings.data.restore.confirm_warning'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      showCancel: true,
      onConfirm: async () => {
        dismissDialog()
        await new Promise<void>(resolve => InteractionManager.runAfterInteractions(() => resolve()))
        const result = await DocumentPicker.getDocumentAsync({ type: 'application/zip' })
        if (result.canceled) return

        const asset = result.assets[0]
        await startRestore({
          name: asset.name,
          uri: asset.uri,
          size: asset.size,
          mimeType: asset.mimeType
        })
      }
    })
  }

  const handleExportMobileSync = async () => {
    try {
      const payload = await exportMobileSyncPayload()
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:T.Z]/g, '')
        .slice(0, 14)
      const tempFile = await saveTextAsFile(payload, `cherry-studio.mobile-sync.${timestamp}`)
      await saveFileToFolder(tempFile.path, `cherry-studio.mobile-sync.${timestamp}.json`, 'application/json')
    } catch (error) {
      logger.error('handleExportMobileSync', error as Error)
      presentDialog('error', {
        title: t('common.error'),
        content: (error as Error).message
      })
    }
  }

  const handleImportMobileSync = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' })
      if (result.canceled) return

      const asset = result.assets[0]
      await startMobileSyncRestore({
        name: asset.name,
        uri: asset.uri,
        size: asset.size,
        mimeType: asset.mimeType
      })
    } catch (error) {
      logger.error('handleImportMobileSync', error as Error)
      presentDialog('error', {
        title: t('common.error'),
        content: (error as Error).message
      })
    }
  }

  const handleDataReset = () => {
    if (isResetting) return

    presentDialog('warning', {
      title: t('settings.data.reset'),
      content: t('settings.data.reset_warning'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      showCancel: true,
      onConfirm: async () => {
        setIsResetting(true)

        try {
          await databaseMaintenance.resetDatabase() // reset sqlite
          await persistor.purge() // reset redux
          await resetCacheDirectory() // reset cache

          delay(() => {
            void reloadApplication()
          }, 200)
        } catch (error) {
          setIsResetting(false)
          presentDialog('error', {
            title: t('common.error'),
            content: t('settings.data.data_reset.error')
          })
          logger.error('handleDataReset', error as Error)
        }
      }
    })
  }

  const handleClearCache = () => {
    if (isResetting) return

    presentDialog('warning', {
      title: t('settings.data.clear_cache.title'),
      content: t('settings.data.clear_cache.warning'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      showCancel: true,
      onConfirm: async () => {
        setIsResetting(true)

        try {
          await resetCacheDirectory() // reset cache
          await loadCacheSize() // refresh cache size after clearing
        } catch (error) {
          presentDialog('error', {
            title: t('common.error'),
            content: t('settings.data.clear_cache.error')
          })
          logger.error('handleDataReset', error as Error)
        } finally {
          setIsResetting(false)
        }
      }
    })
  }

  const handleOpenAppData = async () => {
    try {
      if (Platform.OS === 'android') {
        // Open file manager on Android
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: Paths.document.uri,
          type: 'resource/folder'
        })
      } else {
        // On iOS, we can only share the directory info
        presentDialog('info', {
          title: t('settings.data.app_data'),
          content: `${t('settings.data.app_data_location')}: ${Paths.document.uri}`
        })
      }
    } catch (error) {
      logger.error('handleOpenAppData', error as Error)
      presentDialog('info', {
        title: t('settings.data.app_data'),
        content: `${t('settings.data.app_data_location')}: ${Paths.document.uri}`
      })
    }
  }

  const handleOpenAppLogs = async () => {
    try {
      const logPath = Paths.join(Paths.document.uri, 'app.log')
      const result = await saveFileToFolder(logPath, 'app.log', 'text/plain')

      if (!result.success && result.message !== 'cancelled') {
        presentDialog('info', {
          title: t('settings.data.app_logs'),
          content: `${t('settings.data.log_location')}: ${Paths.join(Paths.document.uri, 'app.log')}`
        })
      }
    } catch (error) {
      logger.error('handleOpenAppLogs', error as Error)
      presentDialog('info', {
        title: t('settings.data.app_logs'),
        content: `${t('settings.data.log_location')}: ${Paths.join(Paths.document.uri, 'app.log')}`
      })
    }
  }

  const settingsItems: SettingGroupConfig[] = [
    {
      id: 'backup-and-restore',
      title: t('settings.data.title'),
      items: [
        {
          id: 'native-backup',
          title: t('settings.data.backup'),
          icon: <Save size={24} />,
          onPress: handleBackup
        },
        {
          id: 'native-restore',
          title: t('settings.data.restore.title'),
          icon: <Folder size={24} />,
          onPress: handleRestore
        },
        {
          id: 'mobile-sync-import',
          title: t('settings.data.mobile_sync_import.title'),
          subtitle: t('settings.data.mobile_sync_import.description'),
          icon: <FolderOpen size={24} />,
          onPress: handleImportMobileSync
        },
        {
          id: 'mobile-sync-export',
          title: t('settings.data.mobile_sync_export.title'),
          subtitle: t('settings.data.mobile_sync_export.description'),
          icon: <Save size={24} />,
          onPress: handleExportMobileSync
        },
        {
          id: 'data-reset',
          title: isResetting ? t('common.loading') : t('settings.data.reset'),
          icon: <RotateCcw size={24} className="text-red-500" />,
          danger: true,
          onPress: handleDataReset,
          disabled: isResetting
        }
      ]
    },
    {
      id: 'app-data',
      title: t('settings.data.data.title'),
      items: [
        {
          id: 'open-app-data',
          title: t('settings.data.app_data'),
          icon: <FolderOpen size={24} />,
          onPress: handleOpenAppData
        },
        {
          id: 'open-app-logs',
          title: t('settings.data.app_logs'),
          icon: <FileText size={24} />,
          onPress: handleOpenAppLogs
        },
        {
          id: 'clear-cache',
          title: t('settings.data.clear_cache.button', { cacheSize }),
          icon: <Trash2 size={24} className="text-red-500" />,
          danger: true,
          onPress: handleClearCache
        }
      ]
    }
  ]

  return (
    <SafeAreaContainer>
      <HeaderBar title={t('settings.data.basic_title')} />

      <Container>
        <YStack className="flex-1 gap-6">
          {settingsItems.map(group => (
            <GroupContainer key={group.id} title={group.title}>
              {group.items.map(item => (
                <SettingItem key={item.id} {...item} />
              ))}
            </GroupContainer>
          ))}
        </YStack>
      </Container>

      <RestoreProgressModal
        isOpen={isModalOpen}
        steps={restoreSteps}
        overallStatus={overallStatus}
        onClose={handleRestoreClose}
      />
      <RestoreProgressModal
        isOpen={isMobileSyncModalOpen}
        steps={mobileSyncRestoreSteps}
        overallStatus={mobileSyncOverallStatus}
        onClose={handleMobileSyncClose}
      />
    </SafeAreaContainer>
  )
}

function GroupContainer({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <YStack className="gap-2">
      <GroupTitle>{title}</GroupTitle>
      <Group>{children}</Group>
    </YStack>
  )
}

function SettingItem({ title, screen, icon, subtitle, danger, onPress, disabled }: SettingItemConfig) {
  const navigation = useNavigation<NavigationProps>()

  const handlePress = () => {
    if (disabled) return

    if (onPress) {
      onPress()
    } else if (screen) {
      navigation.navigate(screen as any)
    }
  }

  return (
    <PressableRow onPress={handlePress} style={{ opacity: disabled ? 0.5 : 1 }}>
      <XStack className="items-center gap-3">
        {icon}
        <YStack>
          <Text className={danger ? 'text-red-500' : ''}>{title}</Text>
          {subtitle && <Text className="text-sm">{subtitle}</Text>}
        </YStack>
      </XStack>
      {screen && <RowRightArrow />}
    </PressableRow>
  )
}
