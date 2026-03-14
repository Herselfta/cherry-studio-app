import type { RouteProp } from '@react-navigation/native'
import { useRoute } from '@react-navigation/native'
import type { Dispatch } from '@reduxjs/toolkit'
import { reloadAppAsync } from 'expo'
import { File } from 'expo-file-system'
import { Button, Spinner } from 'heroui-native'
import { delay } from 'lodash'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  TextField,
  XStack,
  YStack
} from '@/componentsV2'
import SelectionSheet, { presentSelectionSheet } from '@/componentsV2/base/SelectionSheet'
import { Check, Cloud, Download, Eye, EyeOff, RefreshCw, ShieldCheck } from '@/componentsV2/icons/LucideIcon'
import { LAN_RESTORE_STEPS, useRestore } from '@/hooks/useRestore'
import type { DataSourcesStackParamList } from '@/navigators/settings/DataSourcesStackNavigator'
import type { ProgressUpdate } from '@/services/BackupService'
import { restore as restoreBackupFile } from '@/services/BackupService'
import { loggerService } from '@/services/LoggerService'
import {
  backupToWebDav,
  checkWebDavConnection,
  downloadWebDavBackup,
  getWebDavConfig,
  hasValidWebDavConfig,
  listWebDavBackupFiles,
  saveWebDavConfig,
  type WebDavBackupFile
} from '@/services/WebDavService'
import { type FileMetadata, FileTypes } from '@/types/file'
import { formatFileSize } from '@/utils/file'

const logger = loggerService.withContext('WebDavScreen')
const REMOTE_BACKUP_SHEET_NAME = 'webdav-backup-selection-sheet'

type RestoreFile = Omit<FileMetadata, 'md5'>
type WebDavScreenRouteProp = RouteProp<DataSourcesStackParamList, 'WebDavScreen'>

export default function WebDavScreen() {
  const { t } = useTranslation()
  const route = useRoute<WebDavScreenRouteProp>()
  const storedConfig = getWebDavConfig()
  const hasOpenedAutoRestoreRef = useRef(false)

  const [host, setHost] = useState(storedConfig.host)
  const [user, setUser] = useState(storedConfig.user)
  const [password, setPassword] = useState(storedConfig.password)
  const [path, setPath] = useState(storedConfig.path)
  const [showPassword, setShowPassword] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [isLoadingBackups, setIsLoadingBackups] = useState(false)
  const [remoteBackups, setRemoteBackups] = useState<WebDavBackupFile[]>([])

  const draftConfig = useMemo(
    () => ({
      host,
      user,
      password,
      path
    }),
    [host, user, password, path]
  )

  const persistDraftConfig = async () => {
    setIsSaving(true)

    try {
      const normalized = saveWebDavConfig(draftConfig)
      presentDialog('success', {
        title: t('common.success'),
        content: t('settings.webdav.backup.saved')
      })
      return normalized
    } catch (error) {
      logger.error('Failed to save WebDAV config', error as Error)
      presentDialog('error', {
        title: t('common.error'),
        content: t('settings.webdav.backup.invalid_config')
      })
      return null
    } finally {
      setIsSaving(false)
    }
  }

  const ensureConfigReady = useCallback(async () => {
    if (!hasValidWebDavConfig(draftConfig)) {
      presentDialog('error', {
        title: t('common.error'),
        content: t('settings.webdav.backup.invalid_config')
      })
      return null
    }

    return saveWebDavConfig(draftConfig)
  }, [draftConfig, t])

  const restoreFromWebDav = async (
    file: RestoreFile,
    onProgress: (update: ProgressUpdate) => void,
    dispatch: Dispatch
  ) => {
    const currentConfig = saveWebDavConfig(draftConfig)
    onProgress({ step: 'receive_file', status: 'in_progress' })

    const downloaded = await downloadWebDavBackup(file.name, currentConfig)
    onProgress({ step: 'receive_file', status: 'completed' })

    const restoreFile: RestoreFile = {
      id: file.id,
      name: downloaded.fileName,
      origin_name: downloaded.fileName,
      path: downloaded.uri,
      size: downloaded.size,
      ext: '.zip',
      type: FileTypes.DOCUMENT,
      created_at: Date.now(),
      count: 1
    }

    try {
      await restoreBackupFile(restoreFile, onProgress, dispatch)
    } finally {
      try {
        const downloadedFile = new File(downloaded.uri)
        if (downloadedFile.exists) {
          downloadedFile.delete()
        }
      } catch (error) {
        logger.warn('Failed to cleanup downloaded WebDAV backup file', error as Error)
      }
    }
  }

  const { isModalOpen, restoreSteps, overallStatus, startRestore, closeModal } = useRestore({
    stepConfigs: LAN_RESTORE_STEPS,
    clearBeforeRestore: true,
    customRestoreFunction: restoreFromWebDav as any
  })

  const handleRestoreClose = () => {
    closeModal()

    if (overallStatus === 'success') {
      delay(async () => await reloadAppAsync(), 200)
    }
  }

  const handleCheckConnection = async () => {
    const config = await ensureConfigReady()
    if (!config) return

    setIsChecking(true)

    try {
      await checkWebDavConnection(config)
      presentDialog('success', {
        title: t('settings.websearch.check_success'),
        content: t('settings.webdav.backup.connection_success')
      })
    } catch (error) {
      logger.error('WebDAV connection check failed', error as Error)
      presentDialog('error', {
        title: t('settings.websearch.check_fail'),
        content: (error as Error).message || t('common.error_occurred')
      })
    } finally {
      setIsChecking(false)
    }
  }

  const handleBackup = async () => {
    const config = await ensureConfigReady()
    if (!config) return

    setIsBackingUp(true)

    try {
      const uploaded = await backupToWebDav(config)
      presentDialog('success', {
        title: t('common.success'),
        content: t('settings.webdav.backup.backup_success', {
          fileName: uploaded.fileName
        })
      })
    } catch (error) {
      logger.error('WebDAV backup failed', error as Error)
      presentDialog('error', {
        title: t('common.error'),
        content: (error as Error).message || t('common.error_occurred')
      })
    } finally {
      setIsBackingUp(false)
    }
  }

  const handleRestoreSelection = useCallback(async () => {
    const config = await ensureConfigReady()
    if (!config) return

    setIsLoadingBackups(true)

    try {
      const backups = await listWebDavBackupFiles(config)
      setRemoteBackups(backups)

      if (backups.length === 0) {
        presentDialog('info', {
          title: t('settings.webdav.backup.from_webdav'),
          content: t('settings.webdav.backup.empty')
        })
        return
      }

      presentSelectionSheet(REMOTE_BACKUP_SHEET_NAME)
    } catch (error) {
      logger.error('Failed to list WebDAV backups', error as Error)
      presentDialog('error', {
        title: t('common.error'),
        content: (error as Error).message || t('common.error_occurred')
      })
    } finally {
      setIsLoadingBackups(false)
    }
  }, [ensureConfigReady, t])

  useEffect(() => {
    if (!route.params?.autoOpenRestoreSelection || hasOpenedAutoRestoreRef.current) {
      return
    }

    hasOpenedAutoRestoreRef.current = true
    void handleRestoreSelection()
  }, [handleRestoreSelection, route.params?.autoOpenRestoreSelection])

  const handleRestoreBackup = (file: WebDavBackupFile) => {
    presentDialog('warning', {
      title: t('settings.data.restore.title'),
      content: `${t('settings.data.restore.confirm_warning')}\n\n${file.fileName}`,
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      showCancel: true,
      onConfirm: async () => {
        dismissDialog()
        await startRestore({
          name: file.fileName,
          uri: file.fileName,
          size: file.size,
          mimeType: 'application/zip'
        })
      }
    })
  }

  const remoteBackupItems = remoteBackups.map(file => ({
    key: file.fileName,
    label: file.fileName,
    description: `${file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : '--'} · ${formatFileSize(file.size)}`,
    icon: <Download size={18} />,
    onSelect: () => handleRestoreBackup(file)
  }))

  const actionsDisabled = !hasValidWebDavConfig(draftConfig)

  return (
    <SafeAreaContainer className="flex-1">
      <HeaderBar title={t('settings.webdav.title')} />
      <Container>
        <YStack className="gap-2">
          <GroupTitle>{t('settings.webdav.config.title')}</GroupTitle>

          <TextField>
            <TextField.Input
              className="h-12"
              placeholder={t('settings.webdav.config.host_placeholder')}
              value={host}
              onChangeText={setHost}
            />
          </TextField>

          <TextField>
            <TextField.Input
              className="h-12"
              placeholder={t('settings.webdav.config.user_placeholder')}
              value={user}
              onChangeText={setUser}
            />
          </TextField>

          <TextField>
            <TextField.Input
              className="h-12 pr-0"
              placeholder={t('settings.webdav.config.password_placeholder')}
              value={password}
              secureTextEntry={!showPassword}
              onChangeText={setPassword}>
              <TextField.InputEndContent>
                <Button
                  pressableFeedbackVariant="ripple"
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  onPress={() => setShowPassword(prevState => !prevState)}>
                  <Button.Label>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</Button.Label>
                </Button>
              </TextField.InputEndContent>
            </TextField.Input>
          </TextField>

          <TextField>
            <TextField.Input
              className="h-12"
              placeholder={t('settings.webdav.config.path_placeholder')}
              value={path}
              onChangeText={setPath}
            />
          </TextField>

          <Button onPress={persistDraftConfig} isDisabled={isSaving}>
            <Button.Label>{isSaving ? <Spinner size="sm" /> : t('settings.webdav.config.apply')}</Button.Label>
          </Button>
        </YStack>

        <YStack className="gap-2">
          <GroupTitle>{t('settings.webdav.backup.title')}</GroupTitle>
          <Group>
            <PressableRow disabled={isChecking} onPress={handleCheckConnection}>
              <XStack className="items-center gap-3">
                <ShieldCheck size={22} />
                <Text>{t('common.check')}</Text>
              </XStack>
              {isChecking ? <Spinner size="sm" /> : <Check size={18} className="opacity-40" />}
            </PressableRow>

            <PressableRow disabled={actionsDisabled || isBackingUp} onPress={handleBackup}>
              <XStack className="items-center gap-3">
                <Cloud size={22} />
                <Text>{t('settings.webdav.backup.to_webdav')}</Text>
              </XStack>
              {isBackingUp ? <Spinner size="sm" /> : <RowRightArrow />}
            </PressableRow>

            <PressableRow disabled={actionsDisabled || isLoadingBackups} onPress={handleRestoreSelection}>
              <XStack className="items-center gap-3">
                <Download size={22} />
                <Text>{t('settings.webdav.backup.from_webdav')}</Text>
              </XStack>
              {isLoadingBackups ? <Spinner size="sm" /> : <RowRightArrow />}
            </PressableRow>

            <PressableRow disabled={actionsDisabled || isLoadingBackups} onPress={handleRestoreSelection}>
              <XStack className="items-center gap-3">
                <RefreshCw size={22} />
                <Text>{t('settings.webdav.backup.remote_files')}</Text>
              </XStack>
              <Text className="text-foreground-secondary text-xs opacity-60">{remoteBackups.length}</Text>
            </PressableRow>
          </Group>

          <Text className="text-foreground-secondary px-1 text-xs opacity-60">
            {t('settings.webdav.backup.description')}
          </Text>
        </YStack>
      </Container>

      <SelectionSheet
        name={REMOTE_BACKUP_SHEET_NAME}
        detents={['auto', 0.5]}
        items={remoteBackupItems}
        placeholder={t('settings.webdav.backup.remote_files')}
        emptyContent={<Text className="text-center opacity-60">{t('settings.webdav.backup.empty')}</Text>}
      />

      <RestoreProgressModal
        isOpen={isModalOpen}
        steps={restoreSteps}
        overallStatus={overallStatus}
        onClose={handleRestoreClose}
      />
    </SafeAreaContainer>
  )
}
