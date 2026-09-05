/** Host half of Message Edit: turn-atomic forks and structurally reversible versions. */
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle, type AgentOptions, type AgentSetup, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { PresetBearingSession } from '@deepseek-ai/dsh-agent-presets'
import {
  KNOWN_SESSION_EVENT_TYPES,
  type SessionId,
  type Session,
  type SessionEvent,
  type SessionEventType,
  type SurfaceEventType,
  type SurfaceIntent,
  type EpochHeader,
  type RequestContext,
  type RequestHeaderReason,
} from '@deepseek-ai/dsh-session'
;(KNOWN_SESSION_EVENT_TYPES as Set<string>).add('message-edit/version')
import type {
  SessionLineageNode,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query'
import type {
  AssistantMessage,
  CallId,
  ContentBlock,
  MessageId,
  ReasoningEffortId,
  ToolResultMessage,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  MESSAGE_EDIT_PATH,
  MESSAGE_EDIT_VERSION_SCHEMA,
  type CascadePolicy,
  type EditOperation,
  type EditableBlockKind,
  type EditableMessageBlock,
  type ForkMessageRow,
  type ForkOperation,
  type LegacyMessageEditVersionEvent,
  type MessageEditEffect,
  type MessageEditOperation,
  type MessageEditOperationResult,
  type MessageEditTimeline,
  type MessageEditVersionEvent,
  type ModelRoute,
  type RetryableTurn,
  type StoredMessageEditVersionEvent,
  type VersionSummary,
} from './shared.ts'

export {
  MESSAGE_EDIT_PATH,
  MESSAGE_EDIT_VERSION_SCHEMA,
  MESSAGE_EDIT_VIEW_ORDER,
} from './shared.ts'
export type {
  CascadePolicy,
  EditOperation,
  EditableBlockKind,
  EditableMessageBlock,
  ForkMessageRow,
  ForkOperation,
  MessageEditOperation,
  MessageEditOperationResult,
  MessageEditTimeline,
  MessageEditEffect,
  MessageEditInverse,
  MessageEditVersionEvent,
  ModelRoute,
  RerollOperation,
  RetryableTurn,
  RetryOperation,
  VersionOperation,
  VersionSummary,
} from './shared.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Durable branch provenance owned by moeblack/message-edit. */
    'message-edit/version': StoredMessageEditVersionEvent
  }
}

interface HttpRequestLike {
  method?: string
  url?: string
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (error: unknown) => void): this
}

interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): void
}

interface HttpServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (request: HttpRequestLike, response: HttpResponseLike) => void | Promise<void>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: HttpServerLike
  }
}

/** Stable Cordis plugin name. */
export const name = 'message-edit'

/** Public services used by the branch transaction and timeline projection. */
export const inject = [
  'sessions',
  'agents',
  'sessionPersistence',
  'sessionQuery',
  'workspaceRegistry',
  'webServer',
]

type UserEvent = SessionEvent<'user/message'>
type AssistantEvent = SessionEvent<'assistant/message'>
type ToolResultEvent = SessionEvent<'tool/result'>
interface ClosedTurn {
  turn: number
  startSeq: number
  endSeq: number
  user?: UserEvent
  assistants: AssistantEvent[]
  events: SessionEvent[]
}

interface ManualTurnItem {
  kind: 'header' | 'user' | 'assistant' | 'tool.result'
  header?: EpochHeader
  headerReason?: RequestHeaderReason
  context?: RequestContext
  user?: UserMessage
  assistant?: AssistantMessage
  assistantUsage?: AssistantEvent['data']['usage']
  assistantInterrupted?: true
  toolResult?: ToolResultMessage
  toolResultError?: ToolResultEvent['data']['error']
  toolResultMeta?: ToolResultEvent['data']['meta']
  /** Used only when a selected/malformed result has no call row in the draft. */
  toolResultFallbackAssistant?: AssistantMessage
}

interface ManualTurn {
  turn: number
  items: ManualTurnItem[]
}

interface OperationPlan {
  boundary: number
  version: MessageEditVersionEvent
  manualTurns: ManualTurn[]
  queuedUsers: UserMessage[]
}

interface VersionProjection {
  effect: MessageEditEffect
  inverseSessionId: string
  time: number
}

type MessageEditEffectDraft = Omit<MessageEditEffect, 'id'>

function pairVersionEffect(
  sourceSessionId: string,
  effect: MessageEditEffectDraft,
): MessageEditVersionEvent {
  return {
    schemaVersion: MESSAGE_EDIT_VERSION_SCHEMA,
    effect: { ...effect, id: crypto.randomUUID() },
    inverse: { kind: 'restore-version', sessionId: sourceSessionId },
  }
}

function isTextualBlock(block: ContentBlock | undefined): block is Extract<ContentBlock, { type: 'text' | 'reasoning' }> {
  return block?.type === 'text' || block?.type === 'reasoning'
}

function userText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function cloneUser(message: UserMessage, content: ContentBlock[] = structuredClone(message.content)): UserMessage {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'user' as const,
    content: Object.freeze(content),
    source: Object.freeze({ kind: 'user' as const }),
  }) as UserMessage
}

/** Build a fresh user message from composed text. */
function newUserMessage(text: string): UserMessage {
  return Object.freeze({
    id: crypto.randomUUID() as MessageId,
    role: 'user' as const,
    content: Object.freeze([{ type: 'text', text }] as ContentBlock[]),
    source: Object.freeze({ kind: 'user' as const }),
  }) as UserMessage
}

function newInjectedUserMessage(text: string): UserMessage {
  return Object.freeze({
    id: crypto.randomUUID() as MessageId,
    role: 'user' as const,
    content: Object.freeze([{ type: 'text', text }] as ContentBlock[]),
    source: Object.freeze({ kind: 'plugin' as const, plugin: 'context-injection' }),
  }) as UserMessage
}

function newToolResultMessage(text: string, callId = crypto.randomUUID() as CallId): ToolResultMessage {
  return Object.freeze({
    id: crypto.randomUUID() as MessageId,
    role: 'user' as const,
    content: Object.freeze([{
      type: 'tool-result' as const,
      toolCallId: callId,
      content: [{ type: 'text' as const, text }],
    }]),
    source: Object.freeze({ kind: 'tool' as const, callId }),
  }) as ToolResultMessage
}

function replaceTextBlock(content: readonly ContentBlock[], blockIndex: number, text: string): ContentBlock[] {
  const block = content[blockIndex]
  if (!isTextualBlock(block) && block?.type !== 'tool-call') throw new Error('所选内容块不是可编辑文本。')
  return content.map((candidate, index) => index === blockIndex
    ? ({ type: 'text', text } as ContentBlock)
    : structuredClone(candidate))
}

/** Fold turn brackets; open tails are included so generated nodes appear immediately. */
function closedTurns(events: readonly SessionEvent[], includeOpen = true): ClosedTurn[] {
  const result: ClosedTurn[] = []
  let current: Omit<ClosedTurn, 'endSeq'> | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (includeOpen && current !== undefined) {
        result.push({ ...current, endSeq: event.seq - 1 })
      }
      current = {
        turn: event.data.turn,
        startSeq: event.seq,
        assistants: [],
        events: [],
      }
      continue
    }
    if (current === undefined) {
      if (
        event.type === 'user/message' ||
        event.type === 'assistant/message' ||
        event.type === 'tool/result' ||
        event.type === 'request/header' ||
        event.type === 'request/context'
      ) {
        const turnNum = typeof (event.data as { turn?: unknown })?.turn === 'number'
          ? (event.data as { turn: number }).turn
          : 1
        current = {
          turn: turnNum,
          startSeq: event.seq,
          assistants: [],
          events: [],
        }
      } else {
        continue
      }
    }
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'user' && current.user === undefined) {
        current.user = event
      }
      current.events.push(event)
      continue
    }
    if (event.type === 'assistant/message' && (event.data.turn === undefined || event.data.turn === current.turn)) {
      current.assistants.push(event)
      current.events.push(event)
      continue
    }
    if (event.type === 'tool/result' && (event.data.turn === undefined || event.data.turn === current.turn)) {
      current.events.push(event)
      continue
    }
    if (event.type === 'request/header' || event.type === 'request/context') {
      current.events.push(event)
      continue
    }
    if (event.type === 'turn/end' && (event.data.turn === undefined || event.data.turn === current.turn)) {
      result.push({ ...current, endSeq: event.seq })
      current = undefined
    }
  }
  if (includeOpen && current !== undefined) {
    result.push({ ...current, endSeq: Number.POSITIVE_INFINITY })
  }
  return result
}

function formatToolResultText(event: ToolResultEvent): string {
  const msg = event.data.message
  const parts: string[] = []
  for (const block of msg.content) {
    if (block.type === 'tool-result' && Array.isArray(block.content)) {
      for (const nested of block.content) {
        if (nested.type === 'text') parts.push(nested.text)
      }
    }
  }
  return parts.join('\n') || ''
}

function editableMessages(turns: readonly ClosedTurn[]): EditableMessageBlock[] {
  const result: EditableMessageBlock[] = []
  for (const turn of turns) {
    // Process events in exact chronological sequence (by event sequence / time)
    for (const event of turn.events) {
      if (event.type === 'request/header') {
        if (event.data.header?.system) {
          result.push({
            key: `${String(event.seq)}:sys`,
            turn: turn.turn,
            eventSeq: event.seq,
            blockIndex: 0,
            kind: 'system',
            text: event.data.header.system,
            time: event.time,
          })
        }
      } else if (event.type === 'user/message') {
        const isDirectUser = event.data.source.kind === 'user'
        for (const [blockIndex, block] of event.data.content.entries()) {
          if (block.type !== 'text') continue
          result.push({
            key: `${String(event.seq)}:${String(blockIndex)}`,
            turn: turn.turn,
            eventSeq: event.seq,
            blockIndex,
            kind: isDirectUser ? 'user' : 'context.inject',
            text: block.text,
            time: event.time,
          })
        }
      } else if (event.type === 'assistant/message') {
        for (const [blockIndex, block] of event.data.message.content.entries()) {
          if (isTextualBlock(block)) {
            result.push({
              key: `${String(event.seq)}:${String(blockIndex)}`,
              turn: turn.turn,
              eventSeq: event.seq,
              blockIndex,
              kind: block.type === 'reasoning' ? 'assistant.reasoning' : 'assistant.response',
              text: block.text,
              time: event.time,
            })
          } else if (block?.type === 'tool-call') {
            result.push({
              key: `${String(event.seq)}:${String(blockIndex)}`,
              turn: turn.turn,
              eventSeq: event.seq,
              blockIndex,
              kind: 'tool.call',
              text: block.arguments || '{}',
              time: event.time,
              toolName: block.name,
              callId: block.id,
            })
          }
        }
      } else if (event.type === 'tool/result') {
        result.push({
          key: `${String(event.seq)}:res`,
          turn: turn.turn,
          eventSeq: event.seq,
          blockIndex: 0,
          kind: 'tool.result',
          text: formatToolResultText(event),
          time: event.time,
          callId: event.data.message.source.callId,
        })
      }
    }
  }
  return result
}

function retryableTurns(turns: readonly ClosedTurn[]): RetryableTurn[] {
  return turns.flatMap((turn): RetryableTurn[] => turn.user === undefined ? [] : [{
    turn: turn.turn,
    userEventSeq: turn.user.seq,
    preview: userText(turn.user.data),
    time: turn.user.time,
  }])
}

function downstreamUsers(turns: readonly ClosedTurn[], start: number): UserMessage[] {
  return turns.slice(start).flatMap((turn): UserMessage[] => turn.user === undefined
    ? []
    : [cloneUser(turn.user.data)])
}

function assistantReplacement(event: AssistantEvent, blockIndex: number, text: string): AssistantMessage {
  const replaced = replaceTextBlock(event.data.message.content, blockIndex, text)
    .filter(block => block.type === 'text' || block.type === 'reasoning' || block.type === 'tool-call')
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: Object.freeze(replaced),
    source: Object.freeze({
      kind: 'model' as const,
      provider: event.data.message.source.provider,
      model: event.data.message.source.model,
    }),
  }) as AssistantMessage
}

function editPlan(
  operation: EditOperation,
  turns: readonly ClosedTurn[],
  events: readonly SessionEvent[],
  fallback?: AgentOptions,
  preferred?: ModelRoute,
): OperationPlan {
  const turnIndex = turns.findIndex(turn => operation.eventSeq >= turn.startSeq && (turn.endSeq === Number.POSITIVE_INFINITY || operation.eventSeq <= turn.endSeq))
  const turn = turns[turnIndex]
  if (turn === undefined) throw new Error('所选消息不属于已落定回合。')
  const event = turn.user?.seq === operation.eventSeq
    ? turn.user
    : turn.assistants.find(candidate => candidate.seq === operation.eventSeq)
      ?? turn.events.find(candidate => candidate.seq === operation.eventSeq)
  if (event === undefined) throw new Error('所选消息不存在或不可编辑。')

  if (event.type === 'user/message') {
    const before = event.data.content[operation.blockIndex]
    if (before?.type !== 'text') throw new Error('所选用户消息块不是文本。')
    const edited = cloneUser(event.data, replaceTextBlock(event.data.content, operation.blockIndex, operation.text))
    const later = operation.cascade === 'preserve' ? downstreamUsers(turns, turnIndex + 1) : []
    return {
      boundary: turn.startSeq - 1,
      version: pairVersionEffect(operation.sessionId, {
        operation: 'edit',
        cascade: operation.cascade,
        targetTurn: turn.turn,
        targetEventSeq: event.seq,
        targetBlockIndex: operation.blockIndex,
        blockKind: 'user',
        before: before.text,
        after: operation.text,
      }),
      manualTurns: [],
      queuedUsers: [edited, ...later],
    }
  }

  if (event.type === 'request/header') {
    const beforeText = event.data.header?.system ?? ''
    const later = operation.cascade === 'preserve' ? downstreamUsers(turns, turnIndex + 1) : []
    const turnUser = turn.user ? [cloneUser(turn.user.data)] : []
    return {
      boundary: turn.startSeq - 1,
      version: pairVersionEffect(operation.sessionId, {
        operation: 'edit',
        cascade: operation.cascade,
        targetTurn: turn.turn,
        targetEventSeq: event.seq,
        targetBlockIndex: operation.blockIndex,
        blockKind: 'system',
        before: beforeText,
        after: operation.text,
      }),
      manualTurns: [],
      queuedUsers: [...turnUser, ...later],
    }
  }

  if (event.type !== 'assistant/message') throw new Error('所选消息不存在或不可编辑。')

  const before = event.data.message.content[operation.blockIndex]
  if (!isTextualBlock(before) && before?.type !== 'tool-call') throw new Error('所选助手消息块不是文本或工具调用。')
  const blockKind: EditableBlockKind = before.type === 'reasoning'
    ? 'assistant.reasoning'
    : 'assistant.response'
  const beforeText = isTextualBlock(before)
    ? before.text
    : `[工具调用: ${before.name || 'tool'}]${before.arguments ? ` ${before.arguments}` : ''}`
  if (turn.user === undefined) throw new Error('所选助手消息没有可重建的用户输入。')

  const route = modelRoute(events, fallback, preferred)
  const manualTurnItems: ManualTurnItem[] = [
    { kind: 'user', user: cloneUser(turn.user.data) },
  ]
  if (turnIndex === 0) {
    const header = sourceLatestHeader(events, route)
    const context = sourceLatestContext(events, route)
    manualTurnItems.push({
      kind: 'header',
      header,
      ...context === undefined ? {} : { context },
    })
  }
  manualTurnItems.push({
    kind: 'assistant',
    assistant: assistantReplacement(event, operation.blockIndex, operation.text),
  })

  return {
    boundary: turn.startSeq - 1,
    version: pairVersionEffect(operation.sessionId, {
      operation: 'edit',
      cascade: operation.cascade,
      targetTurn: turn.turn,
      targetEventSeq: event.seq,
      targetBlockIndex: operation.blockIndex,
      blockKind,
      before: beforeText,
      after: operation.text,
    }),
    manualTurns: [{
      turn: turn.turn,
      items: manualTurnItems,
    }],
    queuedUsers: operation.cascade === 'preserve'
      ? downstreamUsers(turns, turnIndex + 1)
      : [],
  }
}

function retryPlan(
  sessionId: string,
  turnNumber: number,
  cascade: CascadePolicy,
  turns: readonly ClosedTurn[],
): OperationPlan {
  const turnIndex = turns.findIndex(turn => turn.turn === turnNumber)
  const turn = turns[turnIndex]
  if (turn?.user === undefined) throw new Error('所选回合没有可重放的用户输入。')
  return {
    boundary: turn.startSeq - 1,
    version: pairVersionEffect(sessionId, {
      operation: 'retry',
      cascade,
      targetTurn: turn.turn,
      targetEventSeq: turn.user.seq,
    }),
    manualTurns: [],
    queuedUsers: cascade === 'preserve'
      ? downstreamUsers(turns, turnIndex)
      : [cloneUser(turn.user.data)],
  }
}

function rerollPlan(sessionId: string, turns: readonly ClosedTurn[]): OperationPlan {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn?.user === undefined) continue
    const target = turn.assistants.findLast(event => event.data.message.content.some(isTextualBlock))
    if (target === undefined) continue
    return {
      boundary: turn.startSeq - 1,
      version: pairVersionEffect(sessionId, {
        operation: 'reroll',
        cascade: 'truncate',
        targetTurn: turn.turn,
        targetEventSeq: target.seq,
      }),
      manualTurns: [],
      queuedUsers: [cloneUser(turn.user.data)],
    }
  }
  throw new Error('当前会话没有可重生成的已落定助手回复。')
}

/**
 * Resolve optional client provenance against the source session named by the
 * operation. Provenance is an optimization for retaining complete messages;
 * an old tab, a version switch, or a stale selection can make it point at a
 * different log. In that case the caller must rebuild the row from its text.
 */
function sourceEvent(row: ForkMessageRow, events: readonly SessionEvent[]): SessionEvent | undefined {
  if (row.sourceEventSeq === undefined) return undefined
  const indexed = events[row.sourceEventSeq]
  if (indexed?.seq === row.sourceEventSeq) return indexed
  return events.find(event => event.seq === row.sourceEventSeq)
}

function sourceUserMessage(
  row: ForkMessageRow,
  events: readonly SessionEvent[],
  expectedSource: 'user' | 'context',
): UserMessage | undefined {
  const event = sourceEvent(row, events)
  if (event?.type !== 'user/message') return undefined

  // Context producers can extend MessageSourceMap. Keep any non-user
  // user/message source intact instead of rejecting newer source kinds.
  const sourceKind = event.data.source.kind
  const matches = expectedSource === 'user'
    ? sourceKind === 'user'
    : sourceKind !== 'user'
  if (!matches) return undefined

  const index = row.sourceBlockIndex
  const block = index === undefined ? undefined : event.data.content[index]
  if (block?.type !== 'text') return undefined
  if (block.text === row.text) return event.data
  return {
    ...event.data,
    content: event.data.content.map((candidate, at) => at === index
      ? { ...candidate, text: row.text } as ContentBlock
      : candidate),
  } as UserMessage
}

function routedConfig(
  base: EpochHeader['config'],
  route: ModelRoute,
): EpochHeader['config'] {
  // A composer route owns the effort as well as provider/model. Remove the
  // historical effort first so an omitted selected effort means provider
  // default, rather than silently inheriting the old model's effort.
  const { reasoningEffort: _historicalEffort, ...withoutHistoricalEffort } = base
  return {
    ...withoutHistoricalEffort,
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: route.reasoningEffort as ReasoningEffortId },
  }
}

function routedHeader(
  base: EpochHeader,
  route: ModelRoute,
  system?: string,
): EpochHeader {
  const config = routedConfig(base.config, route)
  const routeChanged = base.config.provider !== config.provider
    || base.config.model !== config.model
    || base.config.reasoningEffort !== config.reasoningEffort
  // Adapter-default markers describe the old model/config and must not be
  // copied into a manually rebuilt header after the route changes.
  const header = routeChanged
    ? (({ adapterDefaults: _historicalDefaults, ...withoutHistoricalDefaults }) => withoutHistoricalDefaults)(base)
    : base
  return {
    ...header,
    config,
    ...system === undefined ? {} : { system },
  }
}

function sourceHeader(
  row: ForkMessageRow,
  events: readonly SessionEvent[],
  route?: ModelRoute,
): EpochHeader | undefined {
  const event = sourceEvent(row, events)
  if (event?.type !== 'request/header') return undefined
  const base = event.data.header
  if (route === undefined) return base.system === row.text ? base : { ...base, system: row.text }
  const routed = routedHeader(base, route, row.text)
  return routed === base ? base : routed
}

function sourceLatestHeader(
  events: readonly SessionEvent[],
  route: ModelRoute,
  fallbackSystem?: string,
): EpochHeader {
  const lastEvent = events.findLast((event): event is SessionEvent<'request/header'> => event.type === 'request/header')
  if (lastEvent !== undefined) return routedHeader(lastEvent.data.header, route, fallbackSystem)
  return routedHeader({ config: { provider: route.provider, model: route.model } }, route, fallbackSystem)
}

function sourceLatestContext(
  events: readonly SessionEvent[],
  route: ModelRoute,
): RequestContext | undefined {
  const lastEvent = events.findLast((event): event is SessionEvent<'request/context'> => event.type === 'request/context')
  if (lastEvent !== undefined) {
    return {
      ...lastEvent.data,
      provider: route.provider,
      model: route.model,
    }
  }
  return undefined
}

function sourceToolResult(
  row: ForkMessageRow,
  events: readonly SessionEvent[],
): Pick<ManualTurnItem, 'toolResult' | 'toolResultError' | 'toolResultMeta'> | undefined {
  const event = sourceEvent(row, events)
  if (event?.type !== 'tool/result') return undefined
  const original = event.data.message
  if (formatToolResultText(event) === row.text) {
    return {
      toolResult: original,
      ...(event.data.error === undefined ? {} : { toolResultError: event.data.error }),
      ...(event.data.meta === undefined ? {} : { toolResultMeta: event.data.meta }),
    }
  }

  const result = original.content[0]
  let replaced = false
  const content = result.content.flatMap((block): ContentBlock[] => {
    if (block.type !== 'text') return [block]
    if (replaced) return []
    replaced = true
    return [{ ...block, text: row.text }]
  })
  if (!replaced) content.unshift({ type: 'text', text: row.text })
  return {
    toolResult: {
      ...original,
      content: [{ ...result, content }],
    } as ToolResultMessage,
    ...(event.data.error === undefined ? {} : { toolResultError: event.data.error }),
    ...(event.data.meta === undefined ? {} : { toolResultMeta: event.data.meta }),
  }
}

/** Recover the model-side call head when a result is selected without its call
 * row, or when reading a branch produced by the older mismatched-ID Fork code. */
function fallbackAssistantForToolResult(
  row: ForkMessageRow,
  events: readonly SessionEvent[],
  route: ModelRoute,
): AssistantMessage | undefined {
  const resultEvent = sourceEvent(row, events)
  const result = resultEvent?.type === 'tool/result' ? resultEvent : undefined
  const callId = (result?.data.message.source.callId ?? row.callId) as CallId | undefined
  if (callId === undefined) return undefined

  let exactBlock: Extract<ContentBlock, { type: 'tool-call' }> | undefined
  let nearbyBlock: Extract<ContentBlock, { type: 'tool-call' }> | undefined
  let modelSource: AssistantMessage['source'] | undefined
  let callEvent: Extract<SessionEvent, { type: 'tool/call' }> | undefined
  const limit = result?.seq ?? Number.POSITIVE_INFINITY

  for (const event of events) {
    if (event.seq >= limit) break
    if (event.type === 'tool/call' && event.data.callId === callId) callEvent = event
    if (event.type !== 'assistant/message') continue
    for (const block of event.data.message.content) {
      if (block.type !== 'tool-call') continue
      if (block.id === callId) {
        exactBlock = block
        modelSource = event.data.message.source
      } else if (
        result !== undefined
        && event.data.turn === result.data.turn
        && event.data.step === result.data.step
      ) {
        nearbyBlock = block
        modelSource = event.data.message.source
      }
    }
  }

  const template = exactBlock ?? nearbyBlock
  const call = template === undefined
    ? {
        type: 'tool-call' as const,
        id: callId,
        name: callEvent?.data.name ?? row.toolName ?? 'tool',
        arguments: callEvent?.data.arguments ?? '{}',
      }
    : { ...template, id: callId }

  return {
    id: crypto.randomUUID() as MessageId,
    role: 'assistant',
    content: [call],
    source: modelSource ?? { kind: 'model', provider: route.provider, model: route.model },
  } as AssistantMessage
}

/** Group draft rows into structured manual turns while cloning complete source
 * messages for unchanged/provenanced rows. New rows alone use text reconstruction. */
function groupForkRowsToTurns(
  rows: readonly ForkMessageRow[],
  route: ModelRoute,
  events: readonly SessionEvent[],
): ManualTurn[] {
  const turns: ManualTurn[] = []
  let current: ManualTurn | undefined
  let pendingAssistantRows: ForkMessageRow[] = []

  const flushAssistant = (turn: ManualTurn): void => {
    if (pendingAssistantRows.length === 0) return
    const sourceSeq = pendingAssistantRows[0]?.sourceEventSeq
    const source = sourceSeq === undefined ? undefined : sourceEvent(pendingAssistantRows[0]!, events)
    const sameSource = source !== undefined
      && pendingAssistantRows.every(row => row.sourceEventSeq === sourceSeq)

    if (sameSource && source?.type === 'assistant/message') {
      const editable = source.data.message.content
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block.type === 'text' || block.type === 'reasoning' || block.type === 'tool-call')
      const complete = editable.length === pendingAssistantRows.length
        && editable.every(({ index }, at) => pendingAssistantRows[at]?.sourceBlockIndex === index)
      if (complete) {
        const replacements = new Map(pendingAssistantRows.map(row => [row.sourceBlockIndex, row]))
        const content = source.data.message.content.map((block, index): ContentBlock => {
          const row = replacements.get(index)
          if (row === undefined) return block
          if (block.type === 'text' || block.type === 'reasoning') {
            return block.text === row.text ? block : { ...block, text: row.text }
          }
          if (block.type === 'tool-call') {
            return block.arguments === row.text ? block : { ...block, arguments: row.text }
          }
          return block
        })
        const unchanged = content.every((block, index) => block === source.data.message.content[index])
        turn.items.push({
          kind: 'assistant',
          assistant: unchanged ? source.data.message : { ...source.data.message, content } as AssistantMessage,
          ...(source.data.usage === undefined ? {} : { assistantUsage: source.data.usage }),
          ...(source.data.interrupted === undefined ? {} : { assistantInterrupted: source.data.interrupted }),
        })
        pendingAssistantRows = []
        return
      }
    }

    const content: ContentBlock[] = pendingAssistantRows.flatMap((row): ContentBlock[] => {
      if (row.kind === 'assistant.reasoning') return row.text.length === 0 ? [] : [{ type: 'reasoning', text: row.text }]
      if (row.kind === 'assistant.response') return row.text.length === 0 ? [] : [{ type: 'text', text: row.text }]
      if (row.kind === 'tool.call') return [{
        type: 'tool-call',
        id: (row.callId || crypto.randomUUID()) as CallId,
        name: row.toolName || 'tool',
        arguments: row.text || '{}',
      }]
      return []
    })
    if (content.length > 0) {
      turn.items.push({
        kind: 'assistant',
        assistant: {
          id: crypto.randomUUID() as MessageId,
          role: 'assistant',
          content,
          source: { kind: 'model', provider: route.provider, model: route.model },
        } as AssistantMessage,
      })
    }
    pendingAssistantRows = []
  }

  for (const row of rows) {
    if (row.kind === 'user') {
      if (current !== undefined) flushAssistant(current)
      current = { turn: turns.length + 1, items: [] }
      current.items.push({ kind: 'user', user: sourceUserMessage(row, events, 'user') ?? newUserMessage(row.text) })
      turns.push(current)
      continue
    }

    if (current === undefined) {
      current = { turn: turns.length + 1, items: [] }
      turns.push(current)
    }

    if (row.kind === 'assistant.reasoning' || row.kind === 'assistant.response' || row.kind === 'tool.call') {
      const pendingSource = pendingAssistantRows[0]?.sourceEventSeq
      if (pendingAssistantRows.length > 0 && pendingSource !== row.sourceEventSeq) flushAssistant(current)
      pendingAssistantRows.push(row)
    } else if (row.kind === 'system') {
      flushAssistant(current)
      const header = sourceHeader(row, events, route) ?? {
        config: routedConfig({ provider: route.provider, model: route.model }, route),
        system: row.text,
      }
      const context = sourceLatestContext(events, route)
      current.items.push({
        kind: 'header',
        header,
        ...context === undefined ? {} : { context },
      })
    } else if (row.kind === 'context.inject') {
      flushAssistant(current)
      current.items.push({
        kind: 'user',
        user: sourceUserMessage(row, events, 'context') ?? newInjectedUserMessage(row.text),
      })
    } else if (row.kind === 'tool.result') {
      flushAssistant(current)
      const cloned = sourceToolResult(row, events)
      const toolResult = cloned?.toolResult
        ?? newToolResultMessage(row.text, row.callId as CallId | undefined)
      const fallbackAssistant = fallbackAssistantForToolResult(row, events, route) ?? {
        id: crypto.randomUUID() as MessageId,
        role: 'assistant' as const,
        content: [{
          type: 'tool-call' as const,
          id: toolResult.source.callId,
          name: row.toolName || 'tool',
          arguments: '{}',
        }],
        source: { kind: 'model' as const, provider: route.provider, model: route.model },
      } as AssistantMessage
      current.items.push({
        kind: 'tool.result',
        ...(cloned ?? {}),
        toolResult,
        toolResultFallbackAssistant: fallbackAssistant,
      })
    }
  }

  if (current !== undefined) flushAssistant(current)
  const filteredTurns = turns.filter(turn => turn.items.length > 0)
  const hasHeader = filteredTurns.some(turn => turn.items.some(item => item.kind === 'header'))
  if (!hasHeader && filteredTurns.length > 0) {
    const header = sourceLatestHeader(events, route)
    const context = sourceLatestContext(events, route)
    const firstTurn = filteredTurns[0]!
    const headerItem: ManualTurnItem = {
      kind: 'header',
      header,
      ...context === undefined ? {} : { context },
    }
    const userIndex = firstTurn.items.findIndex(item => item.kind === 'user')
    if (userIndex !== -1) {
      firstTurn.items.splice(userIndex + 1, 0, headerItem)
    } else {
      firstTurn.items.unshift(headerItem)
    }
  }
  return filteredTurns
}

function forkPlan(
  operation: ForkOperation,
  events: readonly SessionEvent[],
  fallback?: AgentOptions,
  preferred?: ModelRoute,
): OperationPlan {
  const rows = operation.rows
  let queuedUsers: UserMessage[] = []
  let seedRows = rows
  const last = rows[rows.length - 1]
  if (last !== undefined && last.kind === 'user') {
    queuedUsers = [sourceUserMessage(last, events, 'user') ?? newUserMessage(last.text)]
    seedRows = rows.slice(0, -1)
  }

  const route = modelRoute(events, fallback, preferred)
  const manualTurns = groupForkRowsToTurns(seedRows, route, events)

  return {
    boundary: -1,
    version: pairVersionEffect(operation.sessionId, {
      operation: 'fork',
      cascade: 'truncate',
      targetTurn: 0,
      targetEventSeq: 0,
      rowCount: rows.length,
    }),
    manualTurns,
    queuedUsers,
  }
}

function planOperation(
  operation: MessageEditOperation,
  events: readonly SessionEvent[],
  fallback?: AgentOptions,
  preferred?: ModelRoute,
): OperationPlan {
  const turns = closedTurns(events)
  const route = preferred ?? ('route' in operation ? operation.route : undefined)
  switch (operation.action) {
    case 'edit':
      return editPlan(operation, turns, events, fallback, route)
    case 'reroll':
      return rerollPlan(operation.sessionId, turns)
    case 'retry':
      return retryPlan(operation.sessionId, operation.turn, operation.cascade, turns)
    case 'fork':
      return forkPlan(operation, events, fallback, route)
  }
}

function modelRoute(
  events: readonly SessionEvent[],
  fallback?: AgentOptions,
  preferred?: ModelRoute,
): ModelRoute {
  if (preferred?.provider && preferred?.model) {
    return {
      provider: preferred.provider,
      model: preferred.model,
      ...preferred.reasoningEffort === undefined ? {} : { reasoningEffort: preferred.reasoningEffort },
    }
  }
  const config = events.findLast(event => event.type === 'request/header')?.data.header.config
  const provider = preferred?.provider ?? config?.provider ?? fallback?.provider
  const model = preferred?.model ?? config?.model ?? fallback?.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    throw new Error('无法从会话历史解析模型路由。')
  }
  return {
    provider,
    model,
    ...config?.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
  }
}

function agentOptions(
  events: readonly SessionEvent[],
  fallback?: AgentOptions,
  preferred?: ModelRoute,
): AgentOptions {
  /* A composer-forwarded route wins over the last logged request/header so a
     re-execution follows the model and effort the chat input currently targets. */
  const route = modelRoute(events, fallback, preferred)
  const maxTokens = events.findLast(event => event.type === 'request/header')?.data.header.config?.maxTokens
    ?? fallback?.maxTokens
  return {
    provider: route.provider,
    model: route.model,
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

/** Install a one-agent selection so the first and every preserved follow-up
 * request use the same composer model/effort. */
function modelSelectionOf(route: ModelRoute | undefined): ModelSelectionRef | undefined {
  if (route === undefined) return undefined
  return {
    current: {
      provider: route.provider,
      model: route.model,
      ...route.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: route.reasoningEffort as ReasoningEffortId },
    },
    assembled: undefined,
  }
}

async function withSourceAgent<T>(
  ctx: Context,
  sessionId: SessionId,
  operation: (agent: Agent) => Promise<T>,
): Promise<T> {
  let handle: AgentHandle | undefined
  let agent = ctx.agents.get(sessionId)
  if (agent === undefined) {
    const snapshot = await ctx.sessionQuery.readSession(sessionId)
    handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: agentOptions(snapshot.events),
    })
    agent = handle.agent
  }
  try {
    return await agent.runMaintenance(async () => operation(agent))
  } finally {
    await handle?.dispose()
  }
}

function inheritedSeed(source: Session, boundary: number): SessionEvent[] {
  if (boundary === -1) return []
  const boundaryEvent = source.events[boundary]
  if (boundary < 0 || boundaryEvent === undefined || boundaryEvent.seq !== boundary) {
    throw new Error('分支边界不是连续会话事件。')
  }
  return source.events.slice(0, boundary + 1)
}

/** Build seed envelopes locally; Session construction performs canonical validation and freezing. */
function appendLogSeedEvent<T extends Exclude<SessionEventType, SurfaceEventType>>(
  events: SessionEvent[],
  type: T,
  data: SessionEvent<T>['data'],
  ignorable = false,
): void {
  events.push({
    type,
    seq: events.length,
    time: Date.now(),
    data,
    /* Plugin-owned types are outside the core KNOWN_SESSION_EVENT_TYPES catalog; the
       envelope marker lets harness builds that do not know the type skip the record
       instead of refusing the whole log (SessionEvent.ignorable contract). */
    ...(ignorable ? { ignorable: true } : {}),
  } as SessionEvent<T>)
}

function appendSurfaceSeedEvent<T extends SurfaceEventType>(
  events: SessionEvent[],
  type: T,
  data: SessionEvent<T>['data'],
  intent: SurfaceIntent,
): void {
  events.push({
    type,
    seq: events.length,
    time: Date.now(),
    data,
    surfaceOp: intent.surfaceOp,
    ...intent.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: intent.sourceEventSeqs },
  } as SessionEvent<T>)
}

function appendManualTurn(
  events: SessionEvent[],
  manual: ManualTurn,
  emittedCallIds: Set<string>,
): void {
  const { turn, items } = manual
  appendLogSeedEvent(events, 'turn/start', { turn })

  let step = 1
  let stepOpen = false
  const pendingCalls = new Set<CallId>()

  const closeStep = (): void => {
    if (!stepOpen) return
    appendLogSeedEvent(events, 'step/end', { turn, step })
    step += 1
    stepOpen = false
    pendingCalls.clear()
  }

  const openAssistantStep = (
    assistant: AssistantMessage,
    usage?: AssistantEvent['data']['usage'],
    interrupted?: true,
  ): void => {
    closeStep()
    appendLogSeedEvent(events, 'step/start', { turn, step })
    stepOpen = true
    appendSurfaceSeedEvent(events, 'assistant/message', {
      turn,
      step,
      message: assistant,
      ...(usage === undefined ? {} : { usage }),
      ...(interrupted === undefined ? {} : { interrupted }),
    }, {
      surfaceOp: 'append',
      sourceEventSeqs: [],
    })

    for (const block of assistant.content) {
      if (block.type !== 'tool-call') continue
      if (!emittedCallIds.has(block.id)) {
        appendLogSeedEvent(events, 'tool/call', {
          turn,
          step,
          callId: block.id,
          name: block.name,
          arguments: block.arguments,
        })
        emittedCallIds.add(block.id)
      }
      pendingCalls.add(block.id)
    }

    if (pendingCalls.size === 0) closeStep()
  }

  for (const item of items) {
    if (item.kind === 'header') {
      closeStep()
      if (item.header !== undefined) {
        appendLogSeedEvent(events, 'request/header', {
          header: item.header,
          reason: item.headerReason ?? (events.some(e => e.type === 'request/header') ? 'change' : 'initial'),
        })
      }
      if (item.context !== undefined) {
        appendLogSeedEvent(events, 'request/context', item.context)
      }
    } else if (item.kind === 'user' && item.user !== undefined) {
      closeStep()
      appendSurfaceSeedEvent(events, 'user/message', item.user, { surfaceOp: 'append' })
    } else if (item.kind === 'assistant' && item.assistant !== undefined) {
      openAssistantStep(item.assistant, item.assistantUsage, item.assistantInterrupted)
    } else if (item.kind === 'tool.result' && item.toolResult !== undefined) {
      let toolResult = item.toolResult
      let callId = toolResult.source.callId

      // Backward compatibility for an old/stale browser bundle, which sent
      // neither provenance nor callId: pair results to open calls by draft order.
      if (stepOpen && !pendingCalls.has(callId) && pendingCalls.size > 0) {
        const inferred = pendingCalls.values().next().value
        if (inferred !== undefined) {
          const block = toolResult.content[0]
          callId = inferred
          toolResult = {
            ...toolResult,
            source: { ...toolResult.source, callId },
            content: [{ ...block, toolCallId: callId }],
          } as ToolResultMessage
        }
      }

      if (!stepOpen || !pendingCalls.has(callId)) {
        if (!emittedCallIds.has(callId) && item.toolResultFallbackAssistant !== undefined) {
          openAssistantStep(item.toolResultFallbackAssistant)
        } else {
          if (!stepOpen) {
            appendLogSeedEvent(events, 'step/start', { turn, step })
            stepOpen = true
          }
          pendingCalls.add(callId)
        }
      }
      if (!stepOpen || !pendingCalls.has(callId)) {
        throw new Error(`无法为工具结果 ${callId} 恢复对应的工具调用。`)
      }
      appendSurfaceSeedEvent(events, 'tool/result', {
        turn,
        step,
        message: toolResult,
        ...(item.toolResultError === undefined ? {} : { error: item.toolResultError }),
        ...(item.toolResultMeta === undefined ? {} : { meta: item.toolResultMeta }),
      }, {
        surfaceOp: 'append',
      })
      pendingCalls.delete(callId)
      if (pendingCalls.size === 0) closeStep()
    }
  }

  closeStep()
  appendLogSeedEvent(events, 'turn/end', { turn, reason: { kind: 'completed' } })
}

function versionSeed(source: Session, plan: OperationPlan): {
  events: SessionEvent[]
  inheritedLength: number
} {
  const events = inheritedSeed(source, plan.boundary)
  const inheritedLength = events.length
  const emittedCallIds = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool/call' && typeof (event.data as any)?.callId === 'string') {
      emittedCallIds.add((event.data as any).callId)
    }
  }
  /* Marked ignorable: harness builds without this plugin must be able to skip the
     provenance record instead of refusing the whole log (SessionEvent.ignorable). */
  appendLogSeedEvent(events, 'message-edit/version', plan.version, true)
  for (const manual of plan.manualTurns) appendManualTurn(events, manual, emittedCallIds)
  return { events, inheritedLength }
}

function sessionPreset(session: PresetBearingSession): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'agent-preset/selected') return event.data.agentPreset
  }
  return session.header.agentPreset
}

function resolveSourceTitle(
  ctx: Context,
  source: Session,
  proposedTitle?: string,
): string | undefined {
  if (typeof proposedTitle === 'string' && proposedTitle.length > 0) return proposedTitle
  const titleService = ctx.get('sessionTitle') as { resolve?: (session: Session) => string } | undefined
  if (titleService?.resolve !== undefined) {
    try {
      const resolved = titleService.resolve(source)
      if (typeof resolved === 'string' && resolved.length > 0) return resolved
    } catch {
      // ignore
    }
  }
  for (let index = source.events.length - 1; index >= 0; index -= 1) {
    const event = source.events[index]
    if (event?.type === 'session/title' && typeof event.data === 'object' && event.data !== null && 'title' in event.data) {
      const title = (event.data as { title: unknown }).title
      if (typeof title === 'string' && title.length > 0) return title
    }
  }
  return undefined
}

async function createVersionAgent(
  ctx: Context,
  source: Session,
  childId: SessionId,
  plan: OperationPlan,
  options: AgentOptions,
  route?: ModelRoute,
  title?: string,
  cwd?: string,
): Promise<AgentHandle> {
  const seed = versionSeed(source, plan)
  if (title !== undefined && (plan.boundary === -1 || plan.version.effect.operation === 'fork')) {
    appendLogSeedEvent(seed.events, 'session/title', { title } as any)
  }
  const presets = ctx.get('agentPresets')
  const presetId = sessionPreset(source)
  const selection = modelSelectionOf(route)
  let agentPreset: string | undefined
  let setup: AgentSetup | undefined
  if (presets !== undefined && presetId !== undefined) {
    const resolved = (await presets.resolve(presetId)).id
    agentPreset = resolved
    setup = async (agentCtx) => {
      // Install before mounting the preset, matching the normal Agent setup
      // order and ensuring preset request listeners see the selected route.
      if (selection !== undefined) installModelSelection(agentCtx, selection)
      await presets.mount(agentCtx, resolved)
    }
  } else if (selection !== undefined) {
    setup = (agentCtx) => { installModelSelection(agentCtx, selection) }
  }
  const childCwd = cwd ?? source.header.cwd
  const child = await ctx.agents.create({
    sessionId: childId,
    seed: seed.events,
    meta: {
      ...childCwd === undefined ? {} : { cwd: childCwd },
      parentSession: source.id,
      seedLength: seed.inheritedLength,
      ...agentPreset === undefined ? {} : { agentPreset },
    },
    agentOptions: options,
    ...setup === undefined ? {} : { setup },
  })
  try {
    if (title !== undefined) {
      const titleService = ctx.get('sessionTitle') as { rename?: (session: Session, title: string) => void } | undefined
      if (titleService?.rename !== undefined) {
        try {
          titleService.rename(child.agent.session, title)
        } catch {
          // ignore
        }
      }
    }
    await ctx.sessions.flush(child.agent.session)
    return child
  } catch (error: unknown) {
    await child.dispose()
    throw error
  }
}

function sourceWorkspace(ctx: Context, sessionId: SessionId): Workspace | undefined {
  return ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId))
}

function operationWorkspace(
  ctx: Context,
  sourceId: SessionId,
  operation: MessageEditOperation,
): Workspace | undefined {
  if (operation.action === 'fork' && operation.workspaceId !== undefined) {
    const workspace = ctx.workspaceRegistry.get(operation.workspaceId as WorkspaceId)
    if (workspace === undefined) throw new Error('目标工作区不存在。')
    return workspace
  }
  return sourceWorkspace(ctx, sourceId)
}

type OperationInverse = () => void | Promise<void>

async function recoverOperation(inverses: OperationInverse[]): Promise<void> {
  const failures: unknown[] = []
  for (const inverse of inverses.reverse()) {
    try {
      await inverse()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, '版本操作恢复失败。')
}

async function runOperation(ctx: Context, operation: MessageEditOperation): Promise<MessageEditOperationResult> {
  const sourceId = sessionIdOf(operation.sessionId)
  return withSourceAgent(ctx, sourceId, async (source) => {
    const childId = sessionIdOf(`session-${crypto.randomUUID()}`)
    const inverses: OperationInverse[] = []
    try {
      const events = source.session.events
      const title = resolveSourceTitle(ctx, source.session, operation.title)
      const workspace = operationWorkspace(ctx, sourceId, operation)
      const targetCwd = operation.action === 'fork' && operation.workspaceId !== undefined
        ? workspace?.path
        : undefined
      const plan = planOperation(operation, events, source.options, operation.route)
      const options = agentOptions(events, source.options, operation.route)
      const child = await createVersionAgent(
        ctx,
        source.session,
        childId,
        plan,
        options,
        operation.route,
        title,
        targetCwd,
      )
      inverses.push(() => child.dispose())

      if (workspace !== undefined) {
        await workspace.attachSession(childId)
        inverses.push(() => workspace.detachSession(childId))
        if (operation.action === 'fork' && operation.workspaceId !== undefined) {
          for (const candidate of ctx.workspaceRegistry.list()) {
            if (candidate.id === workspace.id || !candidate.sessionIds.includes(childId)) continue
            await candidate.detachSession(childId)
            inverses.push(() => candidate.attachSession(childId))
          }
        }
      }
      for (const message of plan.queuedUsers) child.agent.followup(message)

      inverses.length = 0
      return { sessionId: childId, queuedTurns: plan.queuedUsers.length }
    } catch (error: unknown) {
      try {
        await recoverOperation(inverses)
      } catch (recoveryError: unknown) {
        throw new AggregateError([error, recoveryError], '版本操作及其恢复均失败。')
      }
      throw error
    }
  })
}

function ownVersionEvent(
  header: SessionRecord['header'],
  events: readonly SessionEvent[],
): VersionProjection | undefined {
  const inherited = header.seedLength ?? 0
  const ownEvents = events.filter((event): event is SessionEvent<'message-edit/version'> => (
    event.type === 'message-edit/version' && event.seq >= inherited
  ))
  if (ownEvents.length === 0) return undefined
  if (ownEvents.length > 1) {
    throw new Error(`会话 ${header.id} 包含多个自身版本效果。`)
  }
  const event = ownEvents[0]
  if (event === undefined) return undefined
  const parent = header.parentSession
  if ('schemaVersion' in event.data) {
    const version = event.data
    if (version.schemaVersion !== MESSAGE_EDIT_VERSION_SCHEMA) {
      throw new Error(`会话 ${header.id} 使用不支持的版本效果结构。`)
    }
    if (version.inverse.kind !== 'restore-version'
      || parent === undefined
      || version.inverse.sessionId !== parent) {
      throw new Error(`会话 ${header.id} 的版本效果与逆不匹配。`)
    }
    return { effect: version.effect, inverseSessionId: version.inverse.sessionId, time: event.time }
  }

  const legacy: LegacyMessageEditVersionEvent = event.data
  if (parent === undefined || legacy.sourceSessionId !== parent) {
    throw new Error(`会话 ${header.id} 的旧版恢复目标与父版本不匹配。`)
  }
  return {
    effect: {
      id: `legacy:${header.id}:${String(event.seq)}`,
      operation: legacy.operation,
      cascade: legacy.cascade,
      targetTurn: legacy.targetTurn,
      targetEventSeq: legacy.targetEventSeq,
      ...legacy.targetBlockIndex === undefined ? {} : { targetBlockIndex: legacy.targetBlockIndex },
      ...legacy.blockKind === undefined ? {} : { blockKind: legacy.blockKind },
      ...legacy.before === undefined ? {} : { before: legacy.before },
      ...legacy.after === undefined ? {} : { after: legacy.after },
    },
    inverseSessionId: legacy.sourceSessionId,
    time: event.time,
  }
}

function flattenLineage(
  root: SessionRecord,
  descendants: readonly SessionLineageNode[],
): Array<{ record: SessionRecord; depth: number }> {
  const result: Array<{ record: SessionRecord; depth: number }> = [{ record: root, depth: 0 }]
  const visit = (nodes: readonly SessionLineageNode[], depth: number): void => {
    const ordered = [...nodes].sort((left, right) => (
      left.session.header.createdAt - right.session.header.createdAt
      || String(left.session.header.id).localeCompare(String(right.session.header.id))
    ))
    for (const node of ordered) {
      result.push({ record: node.session, depth })
      visit(node.descendants, depth + 1)
    }
  }
  visit(descendants, 1)
  return result
}

/** Minimal read face of the optional persistence service; borrowed events are
 * consumed synchronously inside one timeline projection. */
interface PersistenceReaderLike {
  inspect(sessionId: SessionId, signal?: AbortSignal): Promise<{ events: readonly SessionEvent[] }>
  readFrom(sessionId: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ events: readonly SessionEvent[] }>
}

/** Bounded parallel inspection of persisted branches; matches the corpus worker shape. */
const TIMELINE_READ_CONCURRENCY = 4

async function mapConcurrent<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index] as T)
    }
  }
  const workers = Math.min(TIMELINE_READ_CONCURRENCY, items.length)
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}

/** Full log for the requested session: live borrow, persisted inspection, query fallback. */
async function readCurrentLog(ctx: Context, sessionId: SessionId): Promise<readonly SessionEvent[]> {
  const live = ctx.sessions.get(sessionId)
  if (live !== undefined) return live.events
  const persistence = ctx.get('sessionPersistence') as PersistenceReaderLike | undefined
  if (persistence !== undefined) return (await persistence.inspect(sessionId)).events
  return (await ctx.sessionQuery.readSession(sessionId)).events
}

/** Own-version scan window for one lineage node: the tail from the durable
 * seed boundary is enough, and root nodes cannot carry a version effect. */
async function versionLog(ctx: Context, record: SessionRecord): Promise<readonly SessionEvent[]> {
  const inherited = record.header.seedLength ?? 0
  const live = ctx.sessions.get(record.header.id)
  if (live !== undefined) return live.events.slice(inherited)
  const persistence = ctx.get('sessionPersistence') as PersistenceReaderLike | undefined
  if (persistence !== undefined) return (await persistence.readFrom(record.header.id, inherited)).events
  return (await ctx.sessionQuery.readSession(record.header.id)).events.slice(inherited)
}

async function timeline(ctx: Context, sessionId: SessionId): Promise<MessageEditTimeline> {
  const targetTrace = await ctx.sessionQuery.traceSession(sessionId)
  const rootId = targetTrace.complete
    ? targetTrace.root.header.id
    : targetTrace.ancestors.at(-1)?.header.id ?? sessionId
  const rootTrace = rootId === sessionId ? targetTrace : await ctx.sessionQuery.traceSession(rootId)
  const lineage = flattenLineage(rootTrace.target, rootTrace.descendants)
  const logs = await mapConcurrent(lineage, async ({ record }): Promise<readonly SessionEvent[]> => {
    if (record.header.id === sessionId) return readCurrentLog(ctx, sessionId)
    if (record.header.parentSession === undefined) return []
    return versionLog(ctx, record)
  })
  const recordsById = new Map(lineage.map(({ record }) => [record.header.id, record]))
  const currentPath = new Set<SessionId>()
  let pathId: SessionId | undefined = sessionId
  while (pathId !== undefined && !currentPath.has(pathId)) {
    currentPath.add(pathId)
    pathId = recordsById.get(pathId)?.header.parentSession
  }

  const versions: VersionSummary[] = lineage.map(({ record, depth }, index) => {
    const version = ownVersionEvent(record.header, logs[index] ?? [])
    return {
      sessionId: record.header.id,
      ...record.header.parentSession === undefined ? {} : { parentSessionId: record.header.parentSession },
      ...version === undefined ? {} : {
        effectId: version.effect.id,
        inverseSessionId: version.inverseSessionId,
      },
      createdAt: version?.time ?? record.header.createdAt,
      depth,
      current: record.header.id === sessionId,
      onCurrentEffectPath: currentPath.has(record.header.id),
      ...version === undefined ? {} : {
        operation: version.effect.operation,
        cascade: version.effect.cascade,
        targetTurn: version.effect.targetTurn,
        ...version.effect.blockKind === undefined ? {} : { blockKind: version.effect.blockKind },
        ...version.effect.before === undefined ? {} : { before: version.effect.before },
        ...version.effect.after === undefined ? {} : { after: version.effect.after },
        ...version.effect.rowCount === undefined ? {} : { rowCount: version.effect.rowCount },
      },
    }
  })
  const effectIds = new Set<string>()
  for (const version of versions) {
    if (version.effectId === undefined) continue
    if (effectIds.has(version.effectId)) throw new Error(`版本效果 ${version.effectId} 重复。`)
    effectIds.add(version.effectId)
  }

  const versionsById = new Map(versions.map(version => [version.sessionId, version]))
  const undoStack: string[] = []
  let undoCursor = versionsById.get(sessionId)
  while (undoCursor?.inverseSessionId !== undefined) {
    const inverseId = undoCursor.inverseSessionId
    if (undoStack.includes(inverseId)) throw new Error('版本效果逆链包含循环。')
    if (!versionsById.has(inverseId)) throw new Error(`恢复目标 ${inverseId} 不在可见版本树中。`)
    undoStack.push(inverseId)
    undoCursor = versionsById.get(inverseId)
  }
  const redoSessionIds = versions
    .filter(version => version.inverseSessionId === sessionId)
    .map(version => version.sessionId)

  const currentIndex = versions.findIndex(version => version.current)
  const currentLog = logs[currentIndex]
  if (currentIndex < 0 || currentLog === undefined) throw new Error('当前版本不在版本树中。')
  const turns = closedTurns(currentLog)
  return {
    sessionId,
    messages: editableMessages(turns),
    retryableTurns: retryableTurns(turns),
    versions,
    undoStack,
    redoSessionIds,
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('请求体必须是 JSON 对象。')
  }
  return value as Record<string, unknown>
}

function sessionIdOf(value: unknown): SessionId {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('sessionId 必须是非空字符串。')
  return value as SessionId
}

function optionalWorkspaceIdOf(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('workspaceId 必须是非空字符串。')
  return value
}

function integerOf(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} 必须是非负安全整数。`)
  }
  return value as number
}

function blockKindOf(value: unknown, label: string): EditableBlockKind {
  if (
    value === 'user' ||
    value === 'assistant.reasoning' ||
    value === 'assistant.response' ||
    value === 'system' ||
    value === 'tool.call' ||
    value === 'tool.result' ||
    value === 'context.inject'
  ) return value
  throw new TypeError(`${label} 消息块类型无效。`)
}

function cascadeOf(value: unknown): CascadePolicy {
  if (value !== 'truncate' && value !== 'preserve') throw new TypeError('cascade 必须是 truncate 或 preserve。')
  return value
}

/** Optional composer-forwarded model/effort selection; absence keeps the logged route. */
function modelRouteOf(value: unknown): ModelRoute | undefined {
  if (value === undefined) return undefined
  const record = objectValue(value)
  const provider = record['provider']
  const model = record['model']
  const reasoningEffort = record['reasoningEffort']
  if (typeof provider !== 'string' || provider.length === 0) throw new TypeError('route.provider 必须是非空字符串。')
  if (typeof model !== 'string' || model.length === 0) throw new TypeError('route.model 必须是非空字符串。')
  if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
    throw new TypeError('route.reasoningEffort 必须是非空字符串。')
  }
  return {
    provider,
    model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }
}

function decodeOperation(value: unknown): MessageEditOperation {
  const record = objectValue(value)
  const sessionId = sessionIdOf(record['sessionId'])
  const route = modelRouteOf(record['route'])
  const title = typeof record['title'] === 'string' && record['title'].length > 0 ? record['title'] : undefined
  switch (record['action']) {
    case 'edit':
      if (typeof record['text'] !== 'string') throw new TypeError('text 必须是字符串。')
      return {
        action: 'edit',
        sessionId,
        eventSeq: integerOf(record['eventSeq'], 'eventSeq'),
        blockIndex: integerOf(record['blockIndex'], 'blockIndex'),
        text: record['text'],
        cascade: cascadeOf(record['cascade']),
        ...(route === undefined ? {} : { route }),
        ...(title === undefined ? {} : { title }),
      }
    case 'reroll':
      return { action: 'reroll', sessionId, ...(route === undefined ? {} : { route }), ...(title === undefined ? {} : { title }) }
    case 'retry':
      return {
        action: 'retry',
        sessionId,
        turn: integerOf(record['turn'], 'turn'),
        cascade: cascadeOf(record['cascade']),
        ...(route === undefined ? {} : { route }),
        ...(title === undefined ? {} : { title }),
      }
    case 'fork': {
      const workspaceId = optionalWorkspaceIdOf(record['workspaceId'])
      const rowsValue = record['rows']
      if (!Array.isArray(rowsValue)) throw new TypeError('rows 必须是数组。')
      const rows = rowsValue.map((row, index) => {
        const item = objectValue(row)
        const kind = blockKindOf(item['kind'], `rows[${index}].kind`)
        if (typeof item['text'] !== 'string') throw new TypeError(`rows[${index}].text 必须是字符串。`)
        const toolName = typeof item['toolName'] === 'string' ? item['toolName'] : undefined
        const callId = typeof item['callId'] === 'string' ? item['callId'] : undefined
        const sourceEventSeq = item['sourceEventSeq'] === undefined
          ? undefined
          : integerOf(item['sourceEventSeq'], `rows[${index}].sourceEventSeq`)
        const sourceBlockIndex = item['sourceBlockIndex'] === undefined
          ? undefined
          : integerOf(item['sourceBlockIndex'], `rows[${index}].sourceBlockIndex`)
        return {
          kind,
          text: item['text'],
          ...toolName ? { toolName } : {},
          ...callId ? { callId } : {},
          ...sourceEventSeq === undefined ? {} : { sourceEventSeq },
          ...sourceBlockIndex === undefined ? {} : { sourceBlockIndex },
        }
      })
      return {
        action: 'fork',
        sessionId,
        rows,
        ...(workspaceId === undefined ? {} : { workspaceId }),
        ...(route === undefined ? {} : { route }),
        ...(title === undefined ? {} : { title }),
      }
    }
    default:
      throw new TypeError('action 必须是 edit、reroll、retry 或 fork。')
  }
}

function requestJson(request: HttpRequestLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder()
    let text = ''
    request.on('data', (chunk) => {
      text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    })
    request.on('end', () => {
      try {
        text += decoder.decode()
        resolve(JSON.parse(text) as unknown)
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function respondJson(response: HttpResponseLike, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function handleRoute(ctx: Context, request: HttpRequestLike, response: HttpResponseLike): Promise<void> {
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url ?? MESSAGE_EDIT_PATH, 'http://message-edit.local')
      const sessionId = sessionIdOf(url.searchParams.get('sessionId'))
      respondJson(response, 200, await timeline(ctx, sessionId))
      return
    }
    if (request.method === 'POST') {
      respondJson(response, 200, await runOperation(ctx, decodeOperation(await requestJson(request))))
      return
    }
    response.writeHead(405)
    response.end()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    respondJson(response, error instanceof TypeError ? 400 : 409, { error: message })
  }
}

/** Register the reversible route contribution. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MESSAGE_EDIT_PATH,
    handler: (request, response) => handleRoute(ctx, request, response),
  }), 'message-edit: HTTP route')
}
