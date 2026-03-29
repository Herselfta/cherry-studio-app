import { loggerService } from '@/services/LoggerService'
import type { Topic } from '@/types/assistant'
import type { Message, MessageBlock } from '@/types/message'
import { storage } from '@/utils'

import { getOrCreateMobileSyncSourceDeviceId, type MobileSyncStorage } from './mobileSyncLedger'

const logger = loggerService.withContext('PortableSyncState')

export const PORTABLE_SYNC_STATE_STORAGE_KEY = 'portable_sync_state_v3'

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
    fingerprints: createEmptyFingerprints()
  }
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function fingerprintTopic(topic: Topic) {
  return stableStringify(topic)
}

function fingerprintMessage(message: Message) {
  return stableStringify(message)
}

function fingerprintMessageBlock(block: MessageBlock) {
  return stableStringify(block)
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
    fingerprints: normalizeFingerprints(state.fingerprints)
  }
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
  targetStorage: MobileSyncStorage = storage
): PortableSyncState {
  const state = cloneState(readPortableSyncState(targetStorage))

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

export function resolvePortableSyncSnapshot({
  currentTopics,
  incomingTopics,
  currentMessages,
  incomingMessages,
  currentMessageBlocks,
  incomingMessageBlocks,
  localState,
  incomingSync
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

    if (localActive && (!remoteActive || comparePortableSyncVersions(localVersion, remoteVersion) >= 0)) {
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

  const messageInputMap = new Map<string, Message>([
    ...currentMessages.map(message => [message.id, message]),
    ...incomingMessages.map(message => [message.id, message])
  ])
  const blockInputMap = new Map<string, MessageBlock>([
    ...currentMessageBlocks.map(block => [block.id, block]),
    ...incomingMessageBlocks.map(block => [block.id, block])
  ])

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
