import type { WebSearchProvider, WebSearchState } from '@/types/websearch'

import type { Assistant, Model, Provider, Topic } from './assistant'
import type { LanguageVarious, ThemeMode } from './index'
import type { MCPServer } from './mcp'
import type { Message, MessageBlock } from './message'

export type BackupData = {
  time: number
  version: number
  app_initialization_version?: number
  indexedDB: ImportIndexedData
  redux: ImportReduxData
  portableImageAssets?: PortableImageAsset[]
}

export type PortableImageAsset = {
  fileId: string
  data: string
  mime?: string
  ext?: string
  name?: string
  origin_name?: string
}

export type ImportIndexedData = {
  topics: {
    id: string
    messages: Message[]
  }[]
  message_blocks: MessageBlock[]
  settings: Setting[]
}

export type Setting = {
  id: string
  value: string
}

export type ImportReduxData = {
  assistants: {
    defaultAssistant: Assistant
    systemAssistants?: Assistant[]
    assistants: Assistant[]
    presets?: Assistant[]
  }
  llm: {
    providers: Provider[]
    defaultModel?: Model
    topicNamingModel?: Model
    quickModel?: Model
    translateModel?: Model
  }
  websearch: WebSearchState & { providers: WebSearchProvider[] }
  settings: {
    userName: string
    theme?: ThemeMode
    language?: LanguageVarious
    webdavHost?: string
    webdavUser?: string
    webdavPass?: string
    webdavPath?: string
  }
  mcp?: {
    servers: MCPServer[]
  }
}

export type ExportIndexedData = {
  topics: Topic[]
  message_blocks: MessageBlock[]
  messages: Message[]
  settings: Setting[]
}

export type ExportReduxData = ImportReduxData
