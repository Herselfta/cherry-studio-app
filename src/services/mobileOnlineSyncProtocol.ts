export const MOBILE_ONLINE_SYNC_PROFILE_ID = 'profile'

export const MOBILE_ONLINE_SYNC_ENTITY_TYPES = ['profile', 'assistant', 'topic', 'message', 'messageBlock'] as const

export const MOBILE_ONLINE_SYNC_DELETABLE_ENTITY_TYPES = ['topic', 'message', 'messageBlock'] as const

export type MobileOnlineSyncEntityType = (typeof MOBILE_ONLINE_SYNC_ENTITY_TYPES)[number]
export type MobileOnlineSyncDeletableEntityType = (typeof MOBILE_ONLINE_SYNC_DELETABLE_ENTITY_TYPES)[number]

export type MobileOnlineSyncVersion = {
  replicaId: string
  lamport: number
}

export type MobileOnlineSyncProfile = {
  id: typeof MOBILE_ONLINE_SYNC_PROFILE_ID
  userName?: string
  avatar?: string
}

export type MobileOnlineSyncAssistant = {
  id: string
  [key: string]: unknown
}

export type MobileOnlineSyncTopic = {
  id: string
  assistantId: string
  name: string
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

export type MobileOnlineSyncMessage = {
  id: string
  assistantId: string
  topicId: string
  createdAt: number
  updatedAt?: number
  [key: string]: unknown
}

export type MobileOnlineSyncMessageBlock = {
  id: string
  messageId: string
  createdAt: number
  updatedAt?: number
  [key: string]: unknown
}

export type MobileOnlineSyncSnapshot = {
  profile: MobileOnlineSyncProfile
  assistants: MobileOnlineSyncAssistant[]
  topics: MobileOnlineSyncTopic[]
  messages: MobileOnlineSyncMessage[]
  messageBlocks: MobileOnlineSyncMessageBlock[]
}

type MobileOnlineSyncEntityRecordMap = {
  profile: MobileOnlineSyncProfile
  assistant: MobileOnlineSyncAssistant
  topic: MobileOnlineSyncTopic
  message: MobileOnlineSyncMessage
  messageBlock: MobileOnlineSyncMessageBlock
}

export type MobileOnlineSyncEntityVersions = Record<MobileOnlineSyncEntityType, Record<string, MobileOnlineSyncVersion>>
export type MobileOnlineSyncEntityFingerprints = Record<MobileOnlineSyncEntityType, Record<string, string>>

export type MobileOnlineSyncTrackerState = {
  replicaId: string
  lamport: number
  frontier: Record<string, number>
  entityVersions: MobileOnlineSyncEntityVersions
  tombstones: MobileOnlineSyncEntityVersions
  fingerprints: MobileOnlineSyncEntityFingerprints
  publishedVersions: MobileOnlineSyncEntityVersions
  publishedTombstones: MobileOnlineSyncEntityVersions
  lastPulledCursor: number
}

export type MobileOnlineSyncChange<T extends MobileOnlineSyncEntityType = MobileOnlineSyncEntityType> =
  | {
      entityType: T
      entityId: string
      op: 'upsert'
      version: MobileOnlineSyncVersion
      data: MobileOnlineSyncEntityRecordMap[T]
    }
  | {
      entityType: T
      entityId: string
      op: 'delete'
      version: MobileOnlineSyncVersion
    }

export type MobileOnlineSyncSkippedChange = {
  change: MobileOnlineSyncChange
  reason: 'duplicate_change' | 'stale_change' | 'missing_payload' | 'missing_parent' | 'unsupported_delete'
}

type SnapshotMaps = {
  profile: Map<string, MobileOnlineSyncProfile>
  assistant: Map<string, MobileOnlineSyncAssistant>
  topic: Map<string, MobileOnlineSyncTopic>
  message: Map<string, MobileOnlineSyncMessage>
  messageBlock: Map<string, MobileOnlineSyncMessageBlock>
}

function createEmptyVersionCollections(): MobileOnlineSyncEntityVersions {
  return {
    profile: {},
    assistant: {},
    topic: {},
    message: {},
    messageBlock: {}
  }
}

function createEmptyFingerprints(): MobileOnlineSyncEntityFingerprints {
  return {
    profile: {},
    assistant: {},
    topic: {},
    message: {},
    messageBlock: {}
  }
}

export function createEmptyMobileOnlineSyncState(replicaId: string): MobileOnlineSyncTrackerState {
  return {
    replicaId,
    lamport: 0,
    frontier: { [replicaId]: 0 },
    entityVersions: createEmptyVersionCollections(),
    tombstones: createEmptyVersionCollections(),
    fingerprints: createEmptyFingerprints(),
    publishedVersions: createEmptyVersionCollections(),
    publishedTombstones: createEmptyVersionCollections(),
    lastPulledCursor: 0
  }
}

function cloneState(state: MobileOnlineSyncTrackerState): MobileOnlineSyncTrackerState {
  return {
    replicaId: state.replicaId,
    lamport: state.lamport,
    frontier: { ...state.frontier },
    entityVersions: {
      profile: { ...state.entityVersions.profile },
      assistant: { ...state.entityVersions.assistant },
      topic: { ...state.entityVersions.topic },
      message: { ...state.entityVersions.message },
      messageBlock: { ...state.entityVersions.messageBlock }
    },
    tombstones: {
      profile: { ...state.tombstones.profile },
      assistant: { ...state.tombstones.assistant },
      topic: { ...state.tombstones.topic },
      message: { ...state.tombstones.message },
      messageBlock: { ...state.tombstones.messageBlock }
    },
    fingerprints: {
      profile: { ...state.fingerprints.profile },
      assistant: { ...state.fingerprints.assistant },
      topic: { ...state.fingerprints.topic },
      message: { ...state.fingerprints.message },
      messageBlock: { ...state.fingerprints.messageBlock }
    },
    publishedVersions: {
      profile: { ...state.publishedVersions.profile },
      assistant: { ...state.publishedVersions.assistant },
      topic: { ...state.publishedVersions.topic },
      message: { ...state.publishedVersions.message },
      messageBlock: { ...state.publishedVersions.messageBlock }
    },
    publishedTombstones: {
      profile: { ...state.publishedTombstones.profile },
      assistant: { ...state.publishedTombstones.assistant },
      topic: { ...state.publishedTombstones.topic },
      message: { ...state.publishedTombstones.message },
      messageBlock: { ...state.publishedTombstones.messageBlock }
    },
    lastPulledCursor: state.lastPulledCursor
  }
}

function compareReplicaIds(left: string, right: string) {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

export function compareMobileOnlineSyncVersions(
  left?: MobileOnlineSyncVersion,
  right?: MobileOnlineSyncVersion
): number {
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

function fingerprintEntity(value: unknown) {
  return stableStringify(value)
}

function isDeletableEntityType(
  entityType: MobileOnlineSyncEntityType
): entityType is MobileOnlineSyncDeletableEntityType {
  return MOBILE_ONLINE_SYNC_DELETABLE_ENTITY_TYPES.includes(entityType as MobileOnlineSyncDeletableEntityType)
}

function advanceFrontier(state: MobileOnlineSyncTrackerState, version?: MobileOnlineSyncVersion) {
  if (!version) {
    return
  }

  state.frontier[version.replicaId] = Math.max(state.frontier[version.replicaId] || 0, version.lamport)
  state.lamport = Math.max(state.lamport, version.lamport)
}

function nextVersion(state: MobileOnlineSyncTrackerState): MobileOnlineSyncVersion {
  const frontierMax = Math.max(0, ...Object.values(state.frontier))
  state.lamport = Math.max(state.lamport, frontierMax) + 1
  state.frontier[state.replicaId] = state.lamport
  return {
    replicaId: state.replicaId,
    lamport: state.lamport
  }
}

function createSnapshotMaps(snapshot: MobileOnlineSyncSnapshot): SnapshotMaps {
  return {
    profile: new Map([[snapshot.profile.id, snapshot.profile]]),
    assistant: new Map(snapshot.assistants.map(assistant => [assistant.id, assistant])),
    topic: new Map(snapshot.topics.map(topic => [topic.id, topic])),
    message: new Map(snapshot.messages.map(message => [message.id, message])),
    messageBlock: new Map(snapshot.messageBlocks.map(block => [block.id, block]))
  }
}

function compareTimestampEntity(
  left: { createdAt?: number; updatedAt?: number; id: string },
  right: { createdAt?: number; updatedAt?: number; id: string }
) {
  const leftTimestamp = left.updatedAt ?? left.createdAt ?? 0
  const rightTimestamp = right.updatedAt ?? right.createdAt ?? 0

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp
  }

  return compareReplicaIds(left.id, right.id)
}

export function normalizeMobileOnlineSyncSnapshot(snapshot: MobileOnlineSyncSnapshot): MobileOnlineSyncSnapshot {
  const profile: MobileOnlineSyncProfile = {
    id: MOBILE_ONLINE_SYNC_PROFILE_ID,
    userName: snapshot.profile?.userName,
    avatar: snapshot.profile?.avatar
  }

  const assistantMap = new Map<string, MobileOnlineSyncAssistant>()
  for (const assistant of snapshot.assistants || []) {
    if (!assistant?.id) {
      continue
    }
    assistantMap.set(assistant.id, {
      ...assistant,
      topics: Array.isArray(assistant.topics) ? [] : assistant.topics
    })
  }

  const topicMap = new Map<string, MobileOnlineSyncTopic>()
  for (const topic of snapshot.topics || []) {
    if (!topic?.id || !topic.assistantId) {
      continue
    }

    const nextTopic: MobileOnlineSyncTopic = {
      ...topic,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt
    }
    const previousTopic = topicMap.get(topic.id)
    if (!previousTopic || compareTimestampEntity(previousTopic, nextTopic) <= 0) {
      topicMap.set(topic.id, nextTopic)
    }
  }

  const validTopicIds = new Set(topicMap.keys())
  const messageMap = new Map<string, MobileOnlineSyncMessage>()
  for (const message of snapshot.messages || []) {
    if (!message?.id || !message.topicId || !validTopicIds.has(message.topicId)) {
      continue
    }

    const previousMessage = messageMap.get(message.id)
    if (!previousMessage || compareTimestampEntity(previousMessage, message) <= 0) {
      messageMap.set(message.id, { ...message })
    }
  }

  const validMessageIds = new Set(messageMap.keys())
  const blockMap = new Map<string, MobileOnlineSyncMessageBlock>()
  for (const block of snapshot.messageBlocks || []) {
    if (!block?.id || !block.messageId || !validMessageIds.has(block.messageId)) {
      continue
    }

    const previousBlock = blockMap.get(block.id)
    if (!previousBlock || compareTimestampEntity(previousBlock, block) <= 0) {
      blockMap.set(block.id, { ...block })
    }
  }

  return {
    profile,
    assistants: Array.from(assistantMap.values()).sort((left, right) => compareReplicaIds(left.id, right.id)),
    topics: Array.from(topicMap.values()).sort(compareTimestampEntity),
    messages: Array.from(messageMap.values()).sort(compareTimestampEntity),
    messageBlocks: Array.from(blockMap.values()).sort(compareTimestampEntity)
  }
}

function buildSnapshotFromMaps(maps: SnapshotMaps): MobileOnlineSyncSnapshot {
  return normalizeMobileOnlineSyncSnapshot({
    profile: maps.profile.get(MOBILE_ONLINE_SYNC_PROFILE_ID) || {
      id: MOBILE_ONLINE_SYNC_PROFILE_ID
    },
    assistants: Array.from(maps.assistant.values()),
    topics: Array.from(maps.topic.values()),
    messages: Array.from(maps.message.values()),
    messageBlocks: Array.from(maps.messageBlock.values())
  })
}

function reconcileSet<T extends { id: string }>(
  entityType: MobileOnlineSyncEntityType,
  items: T[],
  state: MobileOnlineSyncTrackerState
) {
  const currentMap = new Map(items.map(item => [item.id, item]))
  const versionMap = state.entityVersions[entityType]
  const tombstones = state.tombstones[entityType]
  const fingerprints = state.fingerprints[entityType]

  for (const item of items) {
    const nextFingerprint = fingerprintEntity(item)
    const previousFingerprint = fingerprints[item.id]
    const previousVersion = versionMap[item.id]

    if (!previousVersion || previousFingerprint !== nextFingerprint || tombstones[item.id]) {
      versionMap[item.id] = nextVersion(state)
      delete tombstones[item.id]
      delete state.publishedTombstones[entityType][item.id]
    }

    fingerprints[item.id] = nextFingerprint
  }

  const trackedIds = new Set<string>([
    ...Object.keys(versionMap),
    ...Object.keys(fingerprints),
    ...Object.keys(tombstones)
  ])

  for (const id of trackedIds) {
    if (currentMap.has(id)) {
      continue
    }

    delete versionMap[id]
    delete fingerprints[id]
    delete state.publishedVersions[entityType][id]

    if (isDeletableEntityType(entityType)) {
      if (!tombstones[id]) {
        tombstones[id] = nextVersion(state)
      }
      continue
    }

    delete tombstones[id]
    delete state.publishedTombstones[entityType][id]
  }
}

export function prepareMobileOnlineSyncState(
  snapshot: MobileOnlineSyncSnapshot,
  currentState: MobileOnlineSyncTrackerState
) {
  const normalizedSnapshot = normalizeMobileOnlineSyncSnapshot(snapshot)
  const nextState = cloneState(currentState)

  reconcileSet('profile', [normalizedSnapshot.profile], nextState)
  reconcileSet('assistant', normalizedSnapshot.assistants, nextState)
  reconcileSet('topic', normalizedSnapshot.topics, nextState)
  reconcileSet('message', normalizedSnapshot.messages, nextState)
  reconcileSet('messageBlock', normalizedSnapshot.messageBlocks, nextState)

  nextState.frontier[nextState.replicaId] = Math.max(nextState.frontier[nextState.replicaId] || 0, nextState.lamport)

  return {
    snapshot: normalizedSnapshot,
    state: nextState
  }
}

function addUpsertChanges<T extends MobileOnlineSyncEntityType>(
  entityType: T,
  items: MobileOnlineSyncEntityRecordMap[T][],
  state: MobileOnlineSyncTrackerState,
  changes: MobileOnlineSyncChange[]
) {
  const publishedVersions = state.publishedVersions[entityType]
  const entityVersions = state.entityVersions[entityType]

  for (const item of items) {
    const version = entityVersions[item.id]
    if (!version || compareMobileOnlineSyncVersions(version, publishedVersions[item.id]) <= 0) {
      continue
    }

    changes.push({
      entityType,
      entityId: item.id,
      op: 'upsert',
      version,
      data: item
    } as MobileOnlineSyncChange)
  }
}

function addDeleteChanges(
  entityType: MobileOnlineSyncDeletableEntityType,
  state: MobileOnlineSyncTrackerState,
  changes: MobileOnlineSyncChange[]
) {
  const tombstones = state.tombstones[entityType]
  const publishedTombstones = state.publishedTombstones[entityType]

  for (const [entityId, version] of Object.entries(tombstones)) {
    if (compareMobileOnlineSyncVersions(version, publishedTombstones[entityId]) <= 0) {
      continue
    }

    changes.push({
      entityType,
      entityId,
      op: 'delete',
      version
    })
  }
}

function compareChanges(left: MobileOnlineSyncChange, right: MobileOnlineSyncChange) {
  const entityOrder =
    MOBILE_ONLINE_SYNC_ENTITY_TYPES.indexOf(left.entityType) - MOBILE_ONLINE_SYNC_ENTITY_TYPES.indexOf(right.entityType)

  if (entityOrder !== 0) {
    return entityOrder
  }

  const versionOrder = compareMobileOnlineSyncVersions(left.version, right.version)
  if (versionOrder !== 0) {
    return versionOrder
  }

  if (left.op === right.op) {
    return compareReplicaIds(left.entityId, right.entityId)
  }

  return left.op === 'upsert' ? -1 : 1
}

export function buildMobileOnlineSyncChanges(
  snapshot: MobileOnlineSyncSnapshot,
  state: MobileOnlineSyncTrackerState
): MobileOnlineSyncChange[] {
  const normalizedSnapshot = normalizeMobileOnlineSyncSnapshot(snapshot)
  const changes: MobileOnlineSyncChange[] = []

  addUpsertChanges('profile', [normalizedSnapshot.profile], state, changes)
  addUpsertChanges('assistant', normalizedSnapshot.assistants, state, changes)
  addUpsertChanges('topic', normalizedSnapshot.topics, state, changes)
  addUpsertChanges('message', normalizedSnapshot.messages, state, changes)
  addUpsertChanges('messageBlock', normalizedSnapshot.messageBlocks, state, changes)
  addDeleteChanges('topic', state, changes)
  addDeleteChanges('message', state, changes)
  addDeleteChanges('messageBlock', state, changes)

  return changes.sort(compareChanges)
}

export function markMobileOnlineSyncChangesPublished(
  state: MobileOnlineSyncTrackerState,
  changes: MobileOnlineSyncChange[]
): MobileOnlineSyncTrackerState {
  const nextState = cloneState(state)

  for (const change of changes) {
    if (change.op === 'upsert') {
      if (
        compareMobileOnlineSyncVersions(
          change.version,
          nextState.publishedVersions[change.entityType][change.entityId]
        ) > 0
      ) {
        nextState.publishedVersions[change.entityType][change.entityId] = change.version
      }
      delete nextState.publishedTombstones[change.entityType][change.entityId]
      continue
    }

    if (
      compareMobileOnlineSyncVersions(
        change.version,
        nextState.publishedTombstones[change.entityType][change.entityId]
      ) > 0
    ) {
      nextState.publishedTombstones[change.entityType][change.entityId] = change.version
    }
    delete nextState.publishedVersions[change.entityType][change.entityId]
  }

  return nextState
}

function dedupeIncomingChanges(changes: MobileOnlineSyncChange[]) {
  const latestChanges = new Map<string, MobileOnlineSyncChange>()

  for (const change of changes) {
    const key = `${change.entityType}:${change.entityId}`
    const current = latestChanges.get(key)
    if (!current) {
      latestChanges.set(key, change)
      continue
    }

    const compareResult = compareMobileOnlineSyncVersions(change.version, current.version)
    if (compareResult > 0 || (compareResult === 0 && change.op === 'delete' && current.op === 'upsert')) {
      latestChanges.set(key, change)
    }
  }

  return Array.from(latestChanges.values()).sort(compareChanges)
}

function getSkippedReason(
  incomingVersion: MobileOnlineSyncVersion,
  existingVersion?: MobileOnlineSyncVersion
): 'duplicate_change' | 'stale_change' {
  return compareMobileOnlineSyncVersions(incomingVersion, existingVersion) === 0 ? 'duplicate_change' : 'stale_change'
}

function cascadeDeleteMessage(
  messageId: string,
  version: MobileOnlineSyncVersion,
  maps: SnapshotMaps,
  state: MobileOnlineSyncTrackerState
) {
  maps.message.delete(messageId)
  delete state.entityVersions.message[messageId]
  delete state.fingerprints.message[messageId]
  delete state.publishedVersions.message[messageId]
  if (compareMobileOnlineSyncVersions(version, state.tombstones.message[messageId]) > 0) {
    state.tombstones.message[messageId] = version
  }
  if (compareMobileOnlineSyncVersions(version, state.publishedTombstones.message[messageId]) > 0) {
    state.publishedTombstones.message[messageId] = version
  }

  for (const block of Array.from(maps.messageBlock.values())) {
    if (block.messageId !== messageId) {
      continue
    }

    maps.messageBlock.delete(block.id)
    delete state.entityVersions.messageBlock[block.id]
    delete state.fingerprints.messageBlock[block.id]
    delete state.publishedVersions.messageBlock[block.id]
    if (compareMobileOnlineSyncVersions(version, state.tombstones.messageBlock[block.id]) > 0) {
      state.tombstones.messageBlock[block.id] = version
    }
    if (compareMobileOnlineSyncVersions(version, state.publishedTombstones.messageBlock[block.id]) > 0) {
      state.publishedTombstones.messageBlock[block.id] = version
    }
  }
}

function applyDeleteChange(
  change: MobileOnlineSyncChange,
  maps: SnapshotMaps,
  state: MobileOnlineSyncTrackerState
): MobileOnlineSyncSkippedChange | null {
  if (!isDeletableEntityType(change.entityType)) {
    return { change, reason: 'unsupported_delete' }
  }

  const localVersion = state.entityVersions[change.entityType][change.entityId]
  const localTombstone = state.tombstones[change.entityType][change.entityId]
  const newestLocalVersion =
    compareMobileOnlineSyncVersions(localVersion, localTombstone) >= 0 ? localVersion : localTombstone

  if (compareMobileOnlineSyncVersions(change.version, newestLocalVersion) <= 0) {
    return { change, reason: getSkippedReason(change.version, newestLocalVersion) }
  }

  if (change.entityType === 'topic') {
    maps.topic.delete(change.entityId)
    delete state.entityVersions.topic[change.entityId]
    delete state.fingerprints.topic[change.entityId]
    delete state.publishedVersions.topic[change.entityId]
    state.tombstones.topic[change.entityId] = change.version
    state.publishedTombstones.topic[change.entityId] = change.version

    for (const message of Array.from(maps.message.values())) {
      if (message.topicId === change.entityId) {
        cascadeDeleteMessage(message.id, change.version, maps, state)
      }
    }

    return null
  }

  if (change.entityType === 'message') {
    cascadeDeleteMessage(change.entityId, change.version, maps, state)
    return null
  }

  maps.messageBlock.delete(change.entityId)
  delete state.entityVersions.messageBlock[change.entityId]
  delete state.fingerprints.messageBlock[change.entityId]
  delete state.publishedVersions.messageBlock[change.entityId]
  state.tombstones.messageBlock[change.entityId] = change.version
  state.publishedTombstones.messageBlock[change.entityId] = change.version

  return null
}

function applyUpsertChange(
  change: Extract<MobileOnlineSyncChange, { op: 'upsert' }>,
  maps: SnapshotMaps,
  state: MobileOnlineSyncTrackerState
): MobileOnlineSyncSkippedChange | null {
  if (!change.data) {
    return { change, reason: 'missing_payload' }
  }

  const localVersion = state.entityVersions[change.entityType][change.entityId]
  const localTombstone = state.tombstones[change.entityType][change.entityId]
  const newestLocalVersion =
    compareMobileOnlineSyncVersions(localVersion, localTombstone) >= 0 ? localVersion : localTombstone

  if (compareMobileOnlineSyncVersions(change.version, newestLocalVersion) <= 0) {
    return { change, reason: getSkippedReason(change.version, newestLocalVersion) }
  }

  if (change.entityType === 'message') {
    const message = change.data as MobileOnlineSyncMessage
    if (!maps.topic.has(message.topicId)) {
      return { change, reason: 'missing_parent' }
    }
  }

  if (change.entityType === 'messageBlock') {
    const block = change.data as MobileOnlineSyncMessageBlock
    if (!maps.message.has(block.messageId)) {
      return { change, reason: 'missing_parent' }
    }
  }

  maps[change.entityType].set(change.entityId, change.data as never)
  state.entityVersions[change.entityType][change.entityId] = change.version
  state.fingerprints[change.entityType][change.entityId] = fingerprintEntity(change.data)
  state.publishedVersions[change.entityType][change.entityId] = change.version
  delete state.tombstones[change.entityType][change.entityId]
  delete state.publishedTombstones[change.entityType][change.entityId]

  return null
}

export function applyMobileOnlineSyncChanges(
  snapshot: MobileOnlineSyncSnapshot,
  state: MobileOnlineSyncTrackerState,
  incomingChanges: MobileOnlineSyncChange[]
) {
  const nextState = cloneState(state)
  const maps = createSnapshotMaps(normalizeMobileOnlineSyncSnapshot(snapshot))
  const acceptedChanges: MobileOnlineSyncChange[] = []
  const skippedChanges: MobileOnlineSyncSkippedChange[] = []

  for (const change of dedupeIncomingChanges(incomingChanges)) {
    advanceFrontier(nextState, change.version)

    if (change.op === 'delete') {
      const skippedChange = applyDeleteChange(change, maps, nextState)
      if (skippedChange) {
        skippedChanges.push(skippedChange)
      } else {
        acceptedChanges.push(change)
      }
      continue
    }

    const skippedChange = applyUpsertChange(change, maps, nextState)
    if (skippedChange) {
      skippedChanges.push(skippedChange)
    } else {
      acceptedChanges.push(change)
    }
  }

  nextState.frontier[nextState.replicaId] = Math.max(nextState.frontier[nextState.replicaId] || 0, nextState.lamport)

  return {
    snapshot: buildSnapshotFromMaps(maps),
    state: nextState,
    acceptedChanges,
    skippedChanges
  }
}
