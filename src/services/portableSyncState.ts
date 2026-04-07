import { loggerService } from '@/services/LoggerService'
import type { Topic } from '@/types/assistant'
import { type Message, type MessageBlock, MessageBlockType } from '@/types/message'
import { storage } from '@/utils'

import { getOrCreateMobileSyncSourceDeviceId, type MobileSyncStorage } from './mobileSyncLedger'

const logger = loggerService.withContext('PortableSyncState')

export const PORTABLE_SYNC_STATE_STORAGE_KEY = 'portable_sync_state_v3'
export const PORTABLE_SYNC_FINGERPRINT_VERSION = 2

export type PortableSyncVersion = {
  replicaId: string
  lamport: number
}

export type PortableSyncVersionMap = Record<string, PortableSyncVersion>

export type PortableSyncEntityVersions = {
  topics: PortableSyncVersionMap
  messages: PortableSyncVersionMap
  blocks: PortableSyncVersionMap
}

export type PortableSyncMessageSlot = {
  messageId: string
  version: PortableSyncVersion
}

export type PortableSyncMetadata = {
  replicaId: string
  lamport: number
  frontier: Record<string, number>
  entityVersions: PortableSyncEntityVersions
  messageSlots: Record<string, PortableSyncMessageSlot>
  tombstones: PortableSyncEntityVersions
}

type PortableSyncFingerprints = {
  topics: Record<string, string>
  messages: Record<string, string>
  blocks: Record<string, string>
  messageSlots: Record<string, string>
}

export type PortableSyncState = PortableSyncMetadata & {
  fingerprintVersion: number
  fingerprints: PortableSyncFingerprints
}

type PortableSyncSnapshot = {
  topics: Topic[]
  messages: Message[]
  messageBlocks: MessageBlock[]
}

type ResolvePortableSyncSnapshotParams = {
  currentTopics: Topic[]
  incomingTopics: Topic[]
  currentMessages: Message[]
  incomingMessages: Message[]
  currentMessageBlocks: MessageBlock[]
  incomingMessageBlocks: MessageBlock[]
  localState: PortableSyncState
  incomingSync: PortableSyncMetadata
  preferIncomingOnEqualVersion?: boolean
}

export type ResolvePortableSyncSnapshotResult = {
  topics: Topic[]
  messages: Message[]
  messageBlocks: MessageBlock[]
  deletedTopicIds: string[]
  deletedMessageIds: string[]
  deletedBlockIds: string[]
  syncState: PortableSyncState
}

export type PortableSyncDriftDiagnosis = {
  suspected: boolean
  localReplicaId: string
  knownIncomingLamport: number
  localLamport: number
  lamportGap: number
  trackedSharedEntityCount: number
  inflatedEntityCount: number
  identicalInflatedEntityCount: number
  tombstonedInflatedEntityCount: number
}

function hasTrackedEntries(versionMap: PortableSyncVersionMap) {
  return Object.keys(versionMap).length > 0
}

function createEmptyEntityVersions(): PortableSyncEntityVersions {
  return {
    topics: {},
    messages: {},
    blocks: {}
  }
}

function createEmptyFingerprints(): PortableSyncFingerprints {
  return {
    topics: {},
    messages: {},
    blocks: {},
    messageSlots: {}
  }
}

function createEmptyPortableSyncState(replicaId: string): PortableSyncState {
  return {
    replicaId,
    lamport: 0,
    frontier: { [replicaId]: 0 },
    entityVersions: createEmptyEntityVersions(),
    messageSlots: {},
    tombstones: createEmptyEntityVersions(),
    fingerprintVersion: PORTABLE_SYNC_FINGERPRINT_VERSION,
    fingerprints: createEmptyFingerprints()
  }
}

export function hasPortableSyncHistory(state: PortableSyncState) {
  return Boolean(
    state.lamport > 0 ||
    hasTrackedEntries(state.entityVersions.topics) ||
    hasTrackedEntries(state.entityVersions.messages) ||
    hasTrackedEntries(state.entityVersions.blocks) ||
    hasTrackedEntries(state.tombstones.topics) ||
    hasTrackedEntries(state.tombstones.messages) ||
    hasTrackedEntries(state.tombstones.blocks) ||
    Object.keys(state.messageSlots).length > 0
  )
}

function normalizeVersion(value: PortableSyncVersion | undefined): PortableSyncVersion | undefined {
  if (!value || !value.replicaId || typeof value.lamport !== 'number') {
    return undefined
  }

  return {
    replicaId: value.replicaId,
    lamport: value.lamport
  }
}

function normalizeVersionMap(value: PortableSyncVersionMap | undefined): PortableSyncVersionMap {
  if (!value) {
    return {}
  }

  const normalized: PortableSyncVersionMap = {}
  for (const [id, version] of Object.entries(value)) {
    const nextVersion = normalizeVersion(version)
    if (nextVersion) {
      normalized[id] = nextVersion
    }
  }
  return normalized
}

function normalizeEntityVersions(value: PortableSyncEntityVersions | undefined): PortableSyncEntityVersions {
  return {
    topics: normalizeVersionMap(value?.topics),
    messages: normalizeVersionMap(value?.messages),
    blocks: normalizeVersionMap(value?.blocks)
  }
}

function normalizeFingerprints(value: PortableSyncFingerprints | undefined): PortableSyncFingerprints {
  return {
    topics: { ...(value?.topics || {}) },
    messages: { ...(value?.messages || {}) },
    blocks: { ...(value?.blocks || {}) },
    messageSlots: { ...(value?.messageSlots || {}) }
  }
}

function normalizeMessageSlots(
  value: Record<string, PortableSyncMessageSlot> | undefined
): Record<string, PortableSyncMessageSlot> {
  if (!value) {
    return {}
  }

  const normalized: Record<string, PortableSyncMessageSlot> = {}
  for (const [slotKey, slot] of Object.entries(value)) {
    const version = normalizeVersion(slot?.version)
    if (!version) {
      continue
    }

    normalized[slotKey] = {
      messageId: slot?.messageId || '',
      version
    }
  }
  return normalized
}

function normalizeFrontier(value: Record<string, number> | undefined, replicaId: string, lamport: number) {
  const frontier = { ...(value || {}) }
  frontier[replicaId] = Math.max(frontier[replicaId] || 0, lamport)
  return frontier
}

export function readPortableSyncState(targetStorage: MobileSyncStorage = storage): PortableSyncState {
  const replicaId = getOrCreateMobileSyncSourceDeviceId(targetStorage)
  const serialized = targetStorage.getString(PORTABLE_SYNC_STATE_STORAGE_KEY)
  if (!serialized) {
    return createEmptyPortableSyncState(replicaId)
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<PortableSyncState>
    const lamport = typeof parsed.lamport === 'number' ? parsed.lamport : 0

    return {
      replicaId: parsed.replicaId || replicaId,
      lamport,
      frontier: normalizeFrontier(parsed.frontier, parsed.replicaId || replicaId, lamport),
      entityVersions: normalizeEntityVersions(parsed.entityVersions),
      messageSlots: normalizeMessageSlots(parsed.messageSlots),
      tombstones: normalizeEntityVersions(parsed.tombstones),
      fingerprintVersion: typeof parsed.fingerprintVersion === 'number' ? parsed.fingerprintVersion : 0,
      fingerprints: normalizeFingerprints(parsed.fingerprints)
    }
  } catch (error) {
    logger.warn('Failed to parse portable sync state', error)
    return createEmptyPortableSyncState(replicaId)
  }
}

export function writePortableSyncState(state: PortableSyncState, targetStorage: MobileSyncStorage = storage) {
  targetStorage.set(PORTABLE_SYNC_STATE_STORAGE_KEY, JSON.stringify(state))
}

export function toPortableSyncMetadata(state: PortableSyncState): PortableSyncMetadata {
  return {
    replicaId: state.replicaId,
    lamport: state.lamport,
    frontier: { ...state.frontier },
    entityVersions: normalizeEntityVersions(state.entityVersions),
    messageSlots: normalizeMessageSlots(state.messageSlots),
    tombstones: normalizeEntityVersions(state.tombstones)
  }
}

function compareReplicaIds(left: string, right: string) {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

export function comparePortableSyncVersions(left?: PortableSyncVersion, right?: PortableSyncVersion): number {
  if (!left && !right) {
    return 0
  }
  if (!left) {
    return -1
  }
  if (!right) {
    return 1
  }
  if (left.lamport !== right.lamport) {
    return left.lamport - right.lamport
  }
  return compareReplicaIds(left.replicaId, right.replicaId)
}

function nextPortableSyncVersion(state: PortableSyncState): PortableSyncVersion {
  const frontierMax = Math.max(0, ...Object.values(state.frontier))
  state.lamport = Math.max(state.lamport, frontierMax) + 1
  state.frontier[state.replicaId] = state.lamport

  return {
    replicaId: state.replicaId,
    lamport: state.lamport
  }
}

function normalizeStableValue(value: unknown, insideArray = false): unknown {
  if (value === undefined) {
    return insideArray ? null : undefined
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeStableValue(item, true))
  }

  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .flatMap(key => {
        const normalizedValue = normalizeStableValue(record[key])
        return normalizedValue === undefined ? [] : [[key, normalizedValue] as const]
      })
  )
}

function stableStringify(value: unknown): string {
  const normalizedValue = normalizeStableValue(value)
  return JSON.stringify(normalizedValue === undefined ? null : normalizedValue)
}

function normalizePortableTimestamp(value: string | number | undefined) {
  if (typeof value === 'number') {
    return value
  }

  if (!value) {
    return undefined
  }

  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function normalizePortableFileMetadata(file: Record<string, unknown> | undefined) {
  if (!file) {
    return undefined
  }

  return {
    id: typeof file.id === 'string' ? file.id : undefined,
    name: typeof file.name === 'string' ? file.name : undefined,
    origin_name: typeof file.origin_name === 'string' ? file.origin_name : undefined,
    size: typeof file.size === 'number' ? file.size : undefined,
    ext: typeof file.ext === 'string' ? file.ext : undefined,
    type: typeof file.type === 'string' ? file.type : undefined,
    created_at: normalizePortableTimestamp(file.created_at as string | number | undefined),
    count: typeof file.count === 'number' ? file.count : undefined,
    tokens: typeof file.tokens === 'number' ? file.tokens : undefined
  }
}

function toPortableTopicFingerprint(topic: Topic) {
  return {
    id: topic.id,
    assistantId: topic.assistantId,
    name: topic.name,
    createdAt: normalizePortableTimestamp(topic.createdAt),
    updatedAt: normalizePortableTimestamp(topic.updatedAt)
  }
}

function toPortableMessageFingerprint(message: Message) {
  return {
    id: message.id,
    role: message.role,
    assistantId: message.assistantId,
    topicId: message.topicId,
    createdAt: normalizePortableTimestamp(message.createdAt),
    updatedAt: normalizePortableTimestamp(message.updatedAt),
    status: message.status,
    modelId: message.modelId,
    type: message.type,
    useful: message.useful,
    askId: message.askId,
    multiModelMessageStyle: message.multiModelMessageStyle,
    foldSelected: message.foldSelected,
    blocks: [...message.blocks]
  }
}

function toPortableBlockFingerprint(block: MessageBlock) {
  const base = {
    id: block.id,
    messageId: block.messageId,
    type: block.type,
    createdAt: normalizePortableTimestamp(block.createdAt),
    updatedAt: normalizePortableTimestamp(block.updatedAt),
    status: block.status,
    content: 'content' in block ? block.content : undefined,
    language: 'language' in block ? block.language : undefined,
    thinking_millsec: 'thinking_millsec' in block ? block.thinking_millsec : undefined,
    sourceBlockId: 'sourceBlockId' in block ? block.sourceBlockId : undefined,
    knowledgeBaseIds: 'knowledgeBaseIds' in block ? block.knowledgeBaseIds : undefined,
    citationReferences: 'citationReferences' in block ? block.citationReferences : undefined,
    toolId: 'toolId' in block ? block.toolId : undefined,
    toolName: 'toolName' in block ? block.toolName : undefined,
    arguments: 'arguments' in block ? block.arguments : undefined,
    response: 'response' in block ? block.response : undefined,
    knowledge: 'knowledge' in block ? block.knowledge : undefined,
    error: 'error' in block ? block.error : undefined,
    file: 'file' in block ? normalizePortableFileMetadata(block.file as Record<string, unknown> | undefined) : undefined
  }

  if (block.type === MessageBlockType.IMAGE) {
    return {
      ...base,
      url: 'url' in block && !('file' in block && block.file) ? block.url : undefined
    }
  }

  return base
}

function fingerprintTopic(topic: Topic) {
  return stableStringify(toPortableTopicFingerprint(topic))
}

function fingerprintMessage(message: Message) {
  return stableStringify(toPortableMessageFingerprint(message))
}

function fingerprintMessageBlock(block: MessageBlock) {
  return stableStringify(toPortableBlockFingerprint(block))
}

function getPortableMessageSlotKey(message: Message) {
  return message.role === 'assistant' && message.askId ? `assistant:${message.askId}` : undefined
}

function getPortableAssistantModelKey(message: Message) {
  return message.modelId || message.model?.id || message.assistantId
}

function shouldResolvePortableAssistantGroup(messages: Message[]) {
  if (messages.length <= 1) {
    return false
  }

  const hasFoldSelectionState = messages.some(message => typeof message.foldSelected === 'boolean')
  if (hasFoldSelectionState) {
    return true
  }

  return new Set(messages.map(getPortableAssistantModelKey)).size <= 1
}

function getMessageTimestamp(message: Message) {
  return message.updatedAt || message.createdAt
}

function buildPortableMessageSlots(messages: Message[]) {
  const grouped = new Map<string, Message[]>()

  for (const message of messages) {
    const slotKey = getPortableMessageSlotKey(message)
    if (!slotKey) {
      continue
    }

    const existing = grouped.get(slotKey) || []
    grouped.set(slotKey, [...existing, message])
  }

  const slots: Record<string, string> = {}
  for (const [slotKey, slotMessages] of grouped.entries()) {
    if (!shouldResolvePortableAssistantGroup(slotMessages)) {
      continue
    }

    const winner =
      slotMessages.find(message => message.foldSelected) ||
      [...slotMessages].sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left))[0]

    if (winner) {
      slots[slotKey] = winner.id
    }
  }

  return slots
}

function cloneState(state: PortableSyncState): PortableSyncState {
  return {
    replicaId: state.replicaId,
    lamport: state.lamport,
    frontier: { ...state.frontier },
    entityVersions: normalizeEntityVersions(state.entityVersions),
    messageSlots: normalizeMessageSlots(state.messageSlots),
    tombstones: normalizeEntityVersions(state.tombstones),
    fingerprintVersion: state.fingerprintVersion,
    fingerprints: normalizeFingerprints(state.fingerprints)
  }
}

function createPortableSyncStateFromMetadata(
  snapshot: PortableSyncSnapshot,
  incomingSync: PortableSyncMetadata,
  targetStorage: MobileSyncStorage
) {
  const replicaId = getOrCreateMobileSyncSourceDeviceId(targetStorage)
  const nextState: PortableSyncState = {
    replicaId,
    lamport: Math.max(incomingSync.lamport, ...Object.values(incomingSync.frontier)),
    frontier: mergeFrontier({ [replicaId]: 0 }, incomingSync.frontier),
    entityVersions: normalizeEntityVersions(incomingSync.entityVersions),
    messageSlots: normalizeMessageSlots(incomingSync.messageSlots),
    tombstones: normalizeEntityVersions(incomingSync.tombstones),
    fingerprintVersion: PORTABLE_SYNC_FINGERPRINT_VERSION,
    fingerprints: createEmptyFingerprints()
  }
  const activeTopicIds = new Set(
    snapshot.topics
      .filter(
        topic =>
          comparePortableSyncVersions(
            nextState.entityVersions.topics[topic.id],
            nextState.tombstones.topics[topic.id]
          ) > 0
      )
      .map(topic => topic.id)
  )
  const activeMessages = snapshot.messages.filter(
    message =>
      activeTopicIds.has(message.topicId) &&
      comparePortableSyncVersions(
        nextState.entityVersions.messages[message.id],
        nextState.tombstones.messages[message.id]
      ) > 0
  )
  const activeMessageIds = new Set(activeMessages.map(message => message.id))
  const activeBlocks = snapshot.messageBlocks.filter(
    block =>
      activeMessageIds.has(block.messageId) &&
      comparePortableSyncVersions(nextState.entityVersions.blocks[block.id], nextState.tombstones.blocks[block.id]) > 0
  )
  const currentSlots = buildPortableMessageSlots(activeMessages)
  const trackedSlotKeys = new Set<string>([...Object.keys(nextState.messageSlots), ...Object.keys(currentSlots)])

  nextState.fingerprints = {
    topics: Object.fromEntries(
      snapshot.topics.filter(topic => activeTopicIds.has(topic.id)).map(topic => [topic.id, fingerprintTopic(topic)])
    ),
    messages: Object.fromEntries(activeMessages.map(message => [message.id, fingerprintMessage(message)])),
    blocks: Object.fromEntries(activeBlocks.map(block => [block.id, fingerprintMessageBlock(block)])),
    messageSlots: Object.fromEntries(
      [...trackedSlotKeys].map(slotKey => [
        slotKey,
        currentSlots[slotKey] || nextState.messageSlots[slotKey]?.messageId || ''
      ])
    )
  }

  return nextState
}

function migratePortableSyncFingerprints(state: PortableSyncState, snapshot: PortableSyncSnapshot) {
  if (state.fingerprintVersion >= PORTABLE_SYNC_FINGERPRINT_VERSION) {
    return state
  }

  const currentSlots = buildPortableMessageSlots(snapshot.messages)

  return {
    ...state,
    fingerprintVersion: PORTABLE_SYNC_FINGERPRINT_VERSION,
    fingerprints: {
      topics: Object.fromEntries(snapshot.topics.map(topic => [topic.id, fingerprintTopic(topic)])),
      messages: Object.fromEntries(snapshot.messages.map(message => [message.id, fingerprintMessage(message)])),
      blocks: Object.fromEntries(snapshot.messageBlocks.map(block => [block.id, fingerprintMessageBlock(block)])),
      messageSlots: currentSlots
    }
  }
}

export function seedPortableSyncState(
  snapshot: PortableSyncSnapshot,
  incomingSync: PortableSyncMetadata,
  targetStorage: MobileSyncStorage = storage
) {
  const state = createPortableSyncStateFromMetadata(snapshot, incomingSync, targetStorage)
  writePortableSyncState(state, targetStorage)
  return state
}

export function bootstrapPortableSyncState(
  snapshot: PortableSyncSnapshot,
  incomingSync: PortableSyncMetadata,
  targetStorage: MobileSyncStorage = storage
) {
  const state = createPortableSyncStateFromMetadata(snapshot, incomingSync, targetStorage)
  const remoteTopicIds = new Set([...Object.keys(state.entityVersions.topics), ...Object.keys(state.tombstones.topics)])
  const remoteMessageIds = new Set([
    ...Object.keys(state.entityVersions.messages),
    ...Object.keys(state.tombstones.messages)
  ])
  const remoteBlockIds = new Set([...Object.keys(state.entityVersions.blocks), ...Object.keys(state.tombstones.blocks)])
  const localOnlyTopics = snapshot.topics.filter(topic => !remoteTopicIds.has(topic.id))
  const localOnlyMessages = snapshot.messages.filter(message => !remoteMessageIds.has(message.id))
  const localOnlyBlocks = snapshot.messageBlocks.filter(block => !remoteBlockIds.has(block.id))

  for (const topic of localOnlyTopics) {
    state.entityVersions.topics[topic.id] = nextPortableSyncVersion(state)
    delete state.tombstones.topics[topic.id]
    state.fingerprints.topics[topic.id] = fingerprintTopic(topic)
  }

  for (const message of localOnlyMessages) {
    state.entityVersions.messages[message.id] = nextPortableSyncVersion(state)
    delete state.tombstones.messages[message.id]
    state.fingerprints.messages[message.id] = fingerprintMessage(message)
  }

  for (const block of localOnlyBlocks) {
    state.entityVersions.blocks[block.id] = nextPortableSyncVersion(state)
    delete state.tombstones.blocks[block.id]
    state.fingerprints.blocks[block.id] = fingerprintMessageBlock(block)
  }

  const localOnlySlots = buildPortableMessageSlots(localOnlyMessages)
  for (const [slotKey, messageId] of Object.entries(localOnlySlots)) {
    state.messageSlots[slotKey] = {
      messageId,
      version: nextPortableSyncVersion(state)
    }
    state.fingerprints.messageSlots[slotKey] = messageId
  }

  state.frontier[state.replicaId] = Math.max(state.frontier[state.replicaId] || 0, state.lamport)
  writePortableSyncState(state, targetStorage)
  return state
}

function reconcileVersionedSet<T extends { id: string }>(
  currentItems: T[],
  versionMap: PortableSyncVersionMap,
  tombstones: PortableSyncVersionMap,
  fingerprints: Record<string, string>,
  fingerprintItem: (item: T) => string,
  state: PortableSyncState
) {
  const currentMap = new Map(currentItems.map(item => [item.id, item]))

  for (const item of currentItems) {
    const nextFingerprint = fingerprintItem(item)
    const previousFingerprint = fingerprints[item.id]
    const previousVersion = versionMap[item.id]

    if (!previousVersion || previousFingerprint !== nextFingerprint || tombstones[item.id]) {
      versionMap[item.id] = nextPortableSyncVersion(state)
      delete tombstones[item.id]
    }

    fingerprints[item.id] = nextFingerprint
  }

  const trackedIds = new Set<string>([...Object.keys(versionMap), ...Object.keys(fingerprints)])
  for (const id of trackedIds) {
    if (currentMap.has(id)) {
      continue
    }

    if (!tombstones[id]) {
      tombstones[id] = nextPortableSyncVersion(state)
    }

    delete versionMap[id]
    delete fingerprints[id]
  }
}

export function preparePortableSyncState(
  snapshot: PortableSyncSnapshot,
  targetStorage: MobileSyncStorage = storage,
  incomingFrontier?: Record<string, number>
): PortableSyncState {
  const state = migratePortableSyncFingerprints(cloneState(readPortableSyncState(targetStorage)), snapshot)

  // Advance the local Lamport clock to incorporate the incoming device's frontier BEFORE
  // computing new entity versions or tombstones. Without this, locally-deleted topics get
  // tombstone Lamports that are lower than the remote's entity version Lamports (because the
  // stored frontier is stale and hasn't seen the remote's recent operations), causing the
  // remote to "win" and resurrect topics that were intentionally deleted locally. The same
  // issue causes locally-renamed topics to be overwritten by the remote's older name.
  if (incomingFrontier) {
    state.frontier = mergeFrontier(state.frontier, incomingFrontier)
    state.lamport = Math.max(state.lamport, ...Object.values(state.frontier))
  }

  reconcileVersionedSet(
    snapshot.topics,
    state.entityVersions.topics,
    state.tombstones.topics,
    state.fingerprints.topics,
    fingerprintTopic,
    state
  )
  reconcileVersionedSet(
    snapshot.messages,
    state.entityVersions.messages,
    state.tombstones.messages,
    state.fingerprints.messages,
    fingerprintMessage,
    state
  )
  reconcileVersionedSet(
    snapshot.messageBlocks,
    state.entityVersions.blocks,
    state.tombstones.blocks,
    state.fingerprints.blocks,
    fingerprintMessageBlock,
    state
  )

  const currentSlots = buildPortableMessageSlots(snapshot.messages)
  const trackedSlotKeys = new Set<string>([
    ...Object.keys(state.messageSlots),
    ...Object.keys(state.fingerprints.messageSlots),
    ...Object.keys(currentSlots)
  ])

  for (const slotKey of trackedSlotKeys) {
    const currentWinnerId = currentSlots[slotKey] || ''
    const previousWinnerId = state.fingerprints.messageSlots[slotKey] || ''
    const currentSlot = state.messageSlots[slotKey]

    if (!currentSlot || previousWinnerId !== currentWinnerId) {
      state.messageSlots[slotKey] = {
        messageId: currentWinnerId,
        version: nextPortableSyncVersion(state)
      }
    }

    state.fingerprints.messageSlots[slotKey] = currentWinnerId
  }

  state.frontier[state.replicaId] = Math.max(state.frontier[state.replicaId] || 0, state.lamport)
  writePortableSyncState(state, targetStorage)

  return state
}

type PortableSyncDriftCounters = {
  trackedSharedCount: number
  inflatedCount: number
  identicalInflatedCount: number
  tombstonedInflatedCount: number
}

function collectPortableSyncDriftCounters<T extends { id: string }>(
  currentItems: T[],
  incomingItems: T[],
  localVersions: PortableSyncVersionMap,
  incomingVersions: PortableSyncVersionMap,
  incomingTombstones: PortableSyncVersionMap,
  fingerprintItem: (item: T) => string,
  localReplicaId: string,
  knownIncomingLamport: number
): PortableSyncDriftCounters {
  const currentMap = new Map(currentItems.map(item => [item.id, item]))
  const incomingMap = new Map(incomingItems.map(item => [item.id, item]))
  const remoteKnownIds = new Set<string>([...Object.keys(incomingVersions), ...Object.keys(incomingTombstones)])

  let trackedSharedCount = 0
  let inflatedCount = 0
  let identicalInflatedCount = 0
  let tombstonedInflatedCount = 0

  for (const id of remoteKnownIds) {
    const localVersion = localVersions[id]
    if (!localVersion) {
      continue
    }

    trackedSharedCount += 1

    if (localVersion.replicaId !== localReplicaId || localVersion.lamport <= knownIncomingLamport) {
      continue
    }

    inflatedCount += 1

    const incomingVersion = incomingVersions[id]
    const incomingTombstone = incomingTombstones[id]
    if (
      incomingTombstone &&
      (!incomingVersion || comparePortableSyncVersions(incomingTombstone, incomingVersion) >= 0)
    ) {
      tombstonedInflatedCount += 1
      continue
    }

    const currentItem = currentMap.get(id)
    const incomingItem = incomingMap.get(id)
    if (currentItem && incomingItem && fingerprintItem(currentItem) === fingerprintItem(incomingItem)) {
      identicalInflatedCount += 1
    }
  }

  return {
    trackedSharedCount,
    inflatedCount,
    identicalInflatedCount,
    tombstonedInflatedCount
  }
}

export function diagnosePortableSyncVersionDrift({
  currentTopics,
  incomingTopics,
  currentMessages,
  incomingMessages,
  currentMessageBlocks,
  incomingMessageBlocks,
  localState,
  incomingSync
}: ResolvePortableSyncSnapshotParams): PortableSyncDriftDiagnosis {
  const localReplicaId = localState.replicaId
  const knownIncomingLamport = incomingSync.frontier[localReplicaId] || 0
  const topicCounters = collectPortableSyncDriftCounters(
    currentTopics,
    incomingTopics,
    localState.entityVersions.topics,
    incomingSync.entityVersions.topics,
    incomingSync.tombstones.topics,
    fingerprintTopic,
    localReplicaId,
    knownIncomingLamport
  )
  const messageCounters = collectPortableSyncDriftCounters(
    currentMessages,
    incomingMessages,
    localState.entityVersions.messages,
    incomingSync.entityVersions.messages,
    incomingSync.tombstones.messages,
    fingerprintMessage,
    localReplicaId,
    knownIncomingLamport
  )
  const blockCounters = collectPortableSyncDriftCounters(
    currentMessageBlocks,
    incomingMessageBlocks,
    localState.entityVersions.blocks,
    incomingSync.entityVersions.blocks,
    incomingSync.tombstones.blocks,
    fingerprintMessageBlock,
    localReplicaId,
    knownIncomingLamport
  )

  const trackedSharedEntityCount =
    topicCounters.trackedSharedCount + messageCounters.trackedSharedCount + blockCounters.trackedSharedCount
  const inflatedEntityCount = topicCounters.inflatedCount + messageCounters.inflatedCount + blockCounters.inflatedCount
  const identicalInflatedEntityCount =
    topicCounters.identicalInflatedCount + messageCounters.identicalInflatedCount + blockCounters.identicalInflatedCount
  const tombstonedInflatedEntityCount =
    topicCounters.tombstonedInflatedCount +
    messageCounters.tombstonedInflatedCount +
    blockCounters.tombstonedInflatedCount
  const corroboratedInflatedEntityCount = identicalInflatedEntityCount + tombstonedInflatedEntityCount
  const lamportGap = Math.max(0, localState.lamport - knownIncomingLamport)

  const suspected = Boolean(
    knownIncomingLamport > 0 &&
    lamportGap >= 6 &&
    trackedSharedEntityCount >= 3 &&
    inflatedEntityCount >= 3 &&
    inflatedEntityCount * 2 >= trackedSharedEntityCount &&
    corroboratedInflatedEntityCount * 3 >= inflatedEntityCount * 2
  )

  return {
    suspected,
    localReplicaId,
    knownIncomingLamport,
    localLamport: localState.lamport,
    lamportGap,
    trackedSharedEntityCount,
    inflatedEntityCount,
    identicalInflatedEntityCount,
    tombstonedInflatedEntityCount
  }
}

function mergeFrontier(left: Record<string, number>, right: Record<string, number>) {
  const frontier = { ...left }
  for (const [replicaId, lamport] of Object.entries(right)) {
    frontier[replicaId] = Math.max(frontier[replicaId] || 0, lamport)
  }
  return frontier
}

function mergeVersionMaps(left: PortableSyncVersionMap, right: PortableSyncVersionMap) {
  const merged = { ...left }
  for (const [id, version] of Object.entries(right)) {
    if (comparePortableSyncVersions(version, merged[id]) > 0) {
      merged[id] = version
    }
  }
  return merged
}

function mergeMessageSlots(
  left: Record<string, PortableSyncMessageSlot>,
  right: Record<string, PortableSyncMessageSlot>
) {
  const merged = { ...left }
  for (const [slotKey, slot] of Object.entries(right)) {
    const current = merged[slotKey]
    if (!current || comparePortableSyncVersions(slot.version, current.version) > 0) {
      merged[slotKey] = slot
    }
  }
  return merged
}

function buildMessageMap(
  items: Message[],
  versionMap: PortableSyncVersionMap,
  tombstones: PortableSyncVersionMap,
  validTopicIds: Set<string>
) {
  const result = new Map<string, Message>()
  const acceptedVersions: PortableSyncVersionMap = {}

  for (const item of items) {
    const version = versionMap[item.id]
    const tombstone = tombstones[item.id]
    if (!version || comparePortableSyncVersions(version, tombstone) <= 0 || !validTopicIds.has(item.topicId)) {
      continue
    }

    result.set(item.id, item)
    acceptedVersions[item.id] = version
  }

  return { result, acceptedVersions }
}

function buildBlockMap(
  items: MessageBlock[],
  versionMap: PortableSyncVersionMap,
  tombstones: PortableSyncVersionMap,
  validMessageIds: Set<string>
) {
  const result = new Map<string, MessageBlock>()
  const acceptedVersions: PortableSyncVersionMap = {}

  for (const item of items) {
    const version = versionMap[item.id]
    const tombstone = tombstones[item.id]
    if (!version || comparePortableSyncVersions(version, tombstone) <= 0 || !validMessageIds.has(item.messageId)) {
      continue
    }

    result.set(item.id, item)
    acceptedVersions[item.id] = version
  }

  return { result, acceptedVersions }
}

function pruneGhostTopics(
  topicMap: Map<string, Topic>,
  topicVersions: PortableSyncVersionMap,
  messages: Map<string, Message>,
  incomingSync: PortableSyncMetadata,
  localReplicaId: string
) {
  const topicIdsWithMessages = new Set(Array.from(messages.values()).map(message => message.topicId))

  for (const [topicId] of topicMap.entries()) {
    if (topicIdsWithMessages.has(topicId)) {
      continue
    }

    const topicVersion = topicVersions[topicId]
    const touchedByIncomingReplica = Boolean(
      incomingSync.entityVersions.topics[topicId] || incomingSync.tombstones.topics[topicId]
    )
    const isLocalOnlyUntouchedTopic =
      Boolean(topicVersion) && topicVersion.replicaId === localReplicaId && !touchedByIncomingReplica

    if (isLocalOnlyUntouchedTopic) {
      continue
    }

    topicMap.delete(topicId)
    delete topicVersions[topicId]
  }
}

export function resolvePortableSyncSnapshot({
  currentTopics,
  incomingTopics,
  currentMessages,
  incomingMessages,
  currentMessageBlocks,
  incomingMessageBlocks,
  localState,
  incomingSync,
  preferIncomingOnEqualVersion = false
}: ResolvePortableSyncSnapshotParams): ResolvePortableSyncSnapshotResult {
  const mergedTombstones: PortableSyncEntityVersions = {
    topics: mergeVersionMaps(localState.tombstones.topics, normalizeVersionMap(incomingSync.tombstones.topics)),
    messages: mergeVersionMaps(localState.tombstones.messages, normalizeVersionMap(incomingSync.tombstones.messages)),
    blocks: mergeVersionMaps(localState.tombstones.blocks, normalizeVersionMap(incomingSync.tombstones.blocks))
  }

  const topicMap = new Map<string, Topic>()
  const topicVersions: PortableSyncVersionMap = {}
  const currentTopicMap = new Map(currentTopics.map(topic => [topic.id, topic]))
  const incomingTopicMap = new Map(incomingTopics.map(topic => [topic.id, topic]))
  const allTopicIds = new Set<string>([...currentTopicMap.keys(), ...incomingTopicMap.keys()])

  for (const topicId of allTopicIds) {
    const localVersion = localState.entityVersions.topics[topicId]
    const remoteVersion = incomingSync.entityVersions.topics[topicId]
    const tombstoneVersion = mergedTombstones.topics[topicId]
    const localTopic = currentTopicMap.get(topicId)
    const remoteTopic = incomingTopicMap.get(topicId)

    const localActive = Boolean(localTopic) && comparePortableSyncVersions(localVersion, tombstoneVersion) > 0
    const remoteActive = Boolean(remoteTopic) && comparePortableSyncVersions(remoteVersion, tombstoneVersion) > 0

    const versionComparison = comparePortableSyncVersions(localVersion, remoteVersion)

    if (
      localActive &&
      (!remoteActive || versionComparison > 0 || (versionComparison === 0 && !preferIncomingOnEqualVersion))
    ) {
      topicMap.set(topicId, localTopic!)
      topicVersions[topicId] = localVersion!
      continue
    }

    if (remoteActive) {
      topicMap.set(topicId, remoteTopic!)
      topicVersions[topicId] = remoteVersion!
    }
  }

  const finalTopicIds = new Set(topicMap.keys())
  const mergedMessageVersions = mergeVersionMaps(
    localState.entityVersions.messages,
    incomingSync.entityVersions.messages
  )
  const mergedBlockVersions = mergeVersionMaps(localState.entityVersions.blocks, incomingSync.entityVersions.blocks)

  const messageInputMap = new Map<string, Message>()
  for (const message of currentMessages) {
    messageInputMap.set(message.id, message)
  }
  for (const message of incomingMessages) {
    const localVersion = localState.entityVersions.messages[message.id]
    const remoteVersion = incomingSync.entityVersions.messages[message.id]
    if (!localVersion || !remoteVersion || comparePortableSyncVersions(remoteVersion, localVersion) >= 0) {
      messageInputMap.set(message.id, message)
    }
  }

  const blockInputMap = new Map<string, MessageBlock>()
  for (const block of currentMessageBlocks) {
    blockInputMap.set(block.id, block)
  }
  for (const block of incomingMessageBlocks) {
    const localVersion = localState.entityVersions.blocks[block.id]
    const remoteVersion = incomingSync.entityVersions.blocks[block.id]
    if (!localVersion || !remoteVersion || comparePortableSyncVersions(remoteVersion, localVersion) >= 0) {
      blockInputMap.set(block.id, block)
    }
  }

  const { result: mergedMessages, acceptedVersions: messageVersions } = buildMessageMap(
    Array.from(messageInputMap.values()),
    mergedMessageVersions,
    mergedTombstones.messages,
    finalTopicIds
  )

  const mergedSlots = mergeMessageSlots(localState.messageSlots, incomingSync.messageSlots)
  const suppressedMessageIds = new Set<string>()
  const winnerIds = new Set<string>()

  for (const slot of Object.values(mergedSlots)) {
    if (slot.messageId && mergedMessages.has(slot.messageId)) {
      winnerIds.add(slot.messageId)
    }
  }

  for (const message of mergedMessages.values()) {
    const slotKey = getPortableMessageSlotKey(message)
    if (!slotKey) {
      continue
    }

    const slot = mergedSlots[slotKey]
    if (!slot?.messageId || !winnerIds.has(slot.messageId) || slot.messageId === message.id) {
      continue
    }

    suppressedMessageIds.add(message.id)
  }

  for (const messageId of suppressedMessageIds) {
    mergedMessages.delete(messageId)
    delete messageVersions[messageId]
  }

  pruneGhostTopics(topicMap, topicVersions, mergedMessages, incomingSync, localState.replicaId)

  const finalMessageIds = new Set(mergedMessages.keys())
  const { result: mergedBlocks, acceptedVersions: blockVersions } = buildBlockMap(
    Array.from(blockInputMap.values()),
    mergedBlockVersions,
    mergedTombstones.blocks,
    finalMessageIds
  )

  const finalTopics = Array.from(topicMap.values())
  const finalMessages = Array.from(mergedMessages.values())
  const finalBlocks = Array.from(mergedBlocks.values())

  const nextState = cloneState(localState)
  nextState.lamport = Math.max(
    localState.lamport,
    incomingSync.lamport,
    ...Object.values(localState.frontier),
    ...Object.values(incomingSync.frontier)
  )
  nextState.frontier = mergeFrontier(localState.frontier, incomingSync.frontier)
  nextState.entityVersions = {
    topics: topicVersions,
    messages: messageVersions,
    blocks: blockVersions
  }
  nextState.tombstones = mergedTombstones
  nextState.messageSlots = mergedSlots
  nextState.fingerprints = {
    topics: Object.fromEntries(finalTopics.map(topic => [topic.id, fingerprintTopic(topic)])),
    messages: Object.fromEntries(finalMessages.map(message => [message.id, fingerprintMessage(message)])),
    blocks: Object.fromEntries(finalBlocks.map(block => [block.id, fingerprintMessageBlock(block)])),
    messageSlots: Object.fromEntries(Object.entries(mergedSlots).map(([slotKey, slot]) => [slotKey, slot.messageId]))
  }
  nextState.frontier[nextState.replicaId] = Math.max(nextState.frontier[nextState.replicaId] || 0, nextState.lamport)

  return {
    topics: finalTopics,
    messages: finalMessages,
    messageBlocks: finalBlocks,
    deletedTopicIds: currentTopics.filter(topic => !topicMap.has(topic.id)).map(topic => topic.id),
    deletedMessageIds: currentMessages.filter(message => !mergedMessages.has(message.id)).map(message => message.id),
    deletedBlockIds: currentMessageBlocks.filter(block => !mergedBlocks.has(block.id)).map(block => block.id),
    syncState: nextState
  }
}
