/** Timeline tab: durable version tree plus free CRUD over finalized messages,
 * committed as a forked version that regenerates replies. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CascadePolicy,
  EditableBlockKind,
  EditableMessageBlock,
  ForkMessageRow,
  RetryableTurn,
  VersionOperation,
  VersionSummary,
} from '../shared.ts'
import type { MessageEditFace } from './controller.ts'
import styles from './MessageEditTimelineView.module.css'

type MessageEditTimelineViewProps = ConvViewProps & InjectFace<MessageEditFace>

/** One locally composed row: an original block or a newly added row. */
interface DraftRow {
  key: string
  kind: EditableBlockKind
  text: string
  turn?: number
  added: boolean
  toolName?: string
  callId?: string
  sourceEventSeq?: number
  sourceBlockIndex?: number
}

/** A contiguous group of draft rows: one user row (or a userless turn) plus replies. */
interface DraftSection {
  id: string
  turnLabel: string
  preview: string
  retry?: RetryableTurn
  rows: DraftRow[]
}

interface EditingState {
  key: string
  text: string
}

interface TouchDragState {
  type: 'row' | 'section'
  key?: string
  sectionId?: string
  badge: string
  preview: string
  currentX: number
  currentY: number
}

const BLOCK_LABEL: Record<EditableBlockKind, string> = {
  user: '用户消息',
  'assistant.reasoning': '助手思考',
  'assistant.response': '助手回复',
  system: 'System Prompt',
  'tool.call': '工具调用',
  'tool.result': '工具返回',
  'context.inject': '上下文/Skill 注入',
}

const OPERATION_LABEL: Record<VersionOperation, string> = {
  edit: '编辑',
  reroll: '重生成',
  retry: '重试',
  fork: 'Fork',
}

function timeLabel(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function DragGripIcon(): ReactNode {
  return (
    <svg
      width="12"
      height="14"
      viewBox="0 0 12 14"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: 'block', pointerEvents: 'none', flexShrink: 0 }}
    >
      <circle cx="3.5" cy="2.5" r="1.25" />
      <circle cx="8.5" cy="2.5" r="1.25" />
      <circle cx="3.5" cy="7" r="1.25" />
      <circle cx="8.5" cy="7" r="1.25" />
      <circle cx="3.5" cy="11.5" r="1.25" />
      <circle cx="8.5" cy="11.5" r="1.25" />
    </svg>
  )
}

function addedRow(kind: EditableBlockKind): DraftRow {
  return { key: `new-${crypto.randomUUID()}`, kind, text: '', added: true }
}

function changeSummaryText(changes: { added: number; edited: number; deleted: number }): string {
  const parts: string[] = []
  if (changes.added > 0) parts.push(`新增 ${String(changes.added)}`)
  if (changes.edited > 0) parts.push(`编辑 ${String(changes.edited)}`)
  if (changes.deleted > 0) parts.push(`删除 ${String(changes.deleted)}`)
  return parts.join(' · ')
}

/** Group draft rows into sections: each turn in history is an atomic section. */
function buildSections(
  rows: readonly DraftRow[],
  baseline: ReadonlyMap<string, EditableMessageBlock>,
  retryableTurns: readonly RetryableTurn[],
): DraftSection[] {
  const retryable = new Map(retryableTurns.map(turn => [turn.turn, turn]))
  const sections: DraftSection[] = []
  const sectionMap = new Map<string, DraftSection>()

  for (const row of rows) {
    const turnKey = row.turn === undefined ? `added-${row.key}` : `turn-${String(row.turn)}`
    let section = sectionMap.get(turnKey)
    if (section === undefined) {
      section = {
        id: turnKey,
        turnLabel: row.turn === undefined ? '新增回合' : `回合 ${String(row.turn)}`,
        preview: row.text,
        rows: [],
      }
      sectionMap.set(turnKey, section)
      sections.push(section)
    }
    section.rows.push(row)
  }

  for (const section of sections) {
    const userRow = section.rows.find(row => row.kind === 'user')
    const head = section.rows[0]
    section.preview = (userRow ?? head)?.text || '（空内容）'
    
    // Check if eligible for retry
    if (userRow && !userRow.added && userRow.turn !== undefined) {
      const unchanged = section.rows.every(
        row => !row.added && baseline.get(row.key)?.text === row.text,
      )
      if (unchanged) {
        const retry = retryable.get(userRow.turn)
        if (retry !== undefined) section.retry = retry
      }
    }
  }
  return sections
}

function VersionRow({ version, disabled, onOpen }: {
  version: VersionSummary
  disabled: boolean
  onOpen: (sessionId: string) => void
}): ReactNode {
  const depthStyle = { '--message-edit-depth': String(version.depth) } as CSSProperties
  const operation = version.operation === undefined
    ? version.parentSessionId === undefined ? '原始版本' : '外部分支'
    : OPERATION_LABEL[version.operation]
  const target = version.operation === 'fork'
    ? version.rowCount === undefined ? null : ` · ${String(version.rowCount)} 条消息`
    : version.targetTurn === undefined ? null : ` · 回合 ${String(version.targetTurn)}`
  return (
    <li className={styles['versionItem']} style={depthStyle}>
      <button
        type="button"
        className={styles['versionButton']}
        data-current={version.current || undefined}
        disabled={version.current || disabled}
        onClick={() => { onOpen(version.sessionId) }}
      >
        <span className={styles['versionLine']} aria-hidden />
        <span className={styles['versionDot']} aria-hidden />
        <span className={styles['versionMain']}>
          <span className={styles['versionTitle']}>
            {operation}
            {target}
          </span>
          <span className={styles['versionMeta']}>
            {timeLabel(version.createdAt)} · {version.sessionId.slice(0, 12)}
          </span>
          {version.before === undefined && version.after === undefined
            ? null
            : (
              <span className={styles['versionDiff']}>
                <span>原：{version.before || '（空）'}</span>
                <span>新：{version.after || '（空）'}</span>
              </span>
            )}
        </span>
        {version.current
          ? <span className={styles['currentBadge']}>当前</span>
          : version.onCurrentEffectPath
            ? <span className={styles['pathBadge']}>效果链</span>
            : null}
      </button>
    </li>
  )
}

function MessageCard({
  row,
  baseline,
  editing,
  selected,
  disabled,
  isDragging,
  dragOverPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTouchStart,
  onSelectToggle,
  onBeginEdit,
  onCancelEdit,
  onTextChange,
  onApplyEdit,
  onDelete,
}: {
  row: DraftRow
  baseline: EditableMessageBlock | undefined
  editing: EditingState | null
  selected: boolean
  disabled: boolean
  isDragging?: boolean
  dragOverPosition?: 'top' | 'bottom' | null
  onDragStart?: (row: DraftRow) => void
  onDragEnd?: () => void
  onDragOver?: (event: React.DragEvent<HTMLElement>, row: DraftRow) => void
  onDragLeave?: () => void
  onDrop?: (event: React.DragEvent<HTMLElement>, row: DraftRow) => void
  onTouchStart?: (event: React.TouchEvent<HTMLElement>, row: DraftRow) => void
  onSelectToggle: (row: DraftRow) => void
  onBeginEdit: (row: DraftRow) => void
  onCancelEdit: () => void
  onTextChange: (text: string) => void
  onApplyEdit: (row: DraftRow, text: string) => void
  onDelete: (row: DraftRow) => void
}): ReactNode {
  const active = editing?.key === row.key
  const edited = !row.added && baseline !== undefined && baseline.text !== row.text

  const badgeLabel = row.kind === 'tool.call' && row.toolName
    ? `工具调用: ${row.toolName}`
    : BLOCK_LABEL[row.kind] || row.kind
  const kindDataAttr = row.kind.replace('.', '-')

  // Default collapse all multi-line items (all message kinds exceeding 1 line / 70 chars)
  const isMultiLine = row.text.includes('\n') || row.text.length > 70
  const defaultCollapsed = isMultiLine
  const [expanded, setExpanded] = useState<boolean>(!defaultCollapsed)

  return (
    <article
      className={styles['messageCard']}
      data-message-key={row.key}
      data-kind={kindDataAttr}
      data-added={row.added || undefined}
      data-dragging={isDragging || undefined}
      data-drag-over-top={dragOverPosition === 'top' || undefined}
      data-drag-over-bottom={dragOverPosition === 'bottom' || undefined}
      onDragOver={(e) => { onDragOver?.(e, row) }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { onDrop?.(e, row) }}
    >
          <div className={styles['messageHeader']}>
            {!disabled && (
              <span
                className={styles['dragHandle']}
                draggable
                data-active={isDragging || undefined}
                title="按住拖拽排序"
                onTouchStart={(e) => { onTouchStart?.(e, row) }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', row.key)
                  onDragStart?.(row)
                }}
                onDragEnd={() => { onDragEnd?.() }}
              >
                <DragGripIcon />
              </span>
            )}
            <input
              type="checkbox"
              className={styles['checkbox']}
              checked={selected}
              disabled={disabled}
              title="选择此消息进行批量操作"
              onChange={() => { onSelectToggle(row) }}
            />
            <span className={styles['kindBadge']} data-kind={kindDataAttr}>{badgeLabel}</span>
        {row.added
          ? <span className={styles['newBadge']}>新增</span>
          : edited
            ? <span className={styles['editedBadge']}>已修改</span>
            : null}
        {row.added || baseline === undefined
          ? null
          : <span className={styles['messageTime']}>{timeLabel(baseline.time)}</span>}
        <span className={styles['messageSpacer']} aria-hidden />
        <button
          type="button"
          className={styles['textButton']}
          disabled={disabled}
          onClick={() => { active ? onCancelEdit() : onBeginEdit(row) }}
        >
          {active ? '取消' : '编辑'}
        </button>
        <button
          type="button"
          className={styles['textButton']}
          data-danger
          disabled={disabled}
          title={row.kind === 'user' ? '删除该回合及其全部消息' : '删除这条消息'}
          onClick={() => { onDelete(row) }}
        >
          删除
        </button>
      </div>
      {active && editing !== null
        ? (
          <div className={styles['editor']}>
            <textarea
              className={styles['textarea']}
              value={editing.text}
              rows={6}
              autoFocus
              onChange={(event) => { onTextChange(event.currentTarget.value) }}
            />
            <div className={styles['editorActions']}>
              <span className={styles['editorHint']}>
                {row.added
                  ? '新消息只存在于草稿，点击 Fork 后进入新版本历史。'
                  : '修改只保存在草稿，点击 Fork 后生成新版本；原版本保持不变。'}
              </span>
              <button
                type="button"
                className={styles['primaryButton']}
                disabled={disabled || editing.text.length === 0}
                onClick={() => { onApplyEdit(row, editing.text) }}
              >
                {row.added ? '添加' : '完成编辑'}
              </button>
            </div>
          </div>
        )
        : (
          <div className={styles['messageTextWrapper']}>
            <pre
              className={`${styles['messageText']}${!expanded && isMultiLine ? ` ${styles['messageTextCollapsed']}` : ''}`}
            >
              {row.text || '（空内容）'}
            </pre>
            {isMultiLine && (
              <button
                type="button"
                className={styles['expandButton']}
                onClick={() => { setExpanded(!expanded) }}
              >
                {expanded ? '收起' : '展开全文'}
              </button>
            )}
          </div>
        )}
    </article>
  )
}

/** Conversation view entry: the durable version timeline plus the message composer. */
export function MessageEditTimelineView({
  useMessageEdit,
  acquire,
  load,
  retry,
  reroll,
  fork,
  openVersion,
  sessionId,
  useWorkspaces,
}: MessageEditTimelineViewProps): ReactNode {
  const state = useMessageEdit(value => value)
  const workspaceItems = useWorkspaces(value => value.items)
  const [cascade, setCascade] = useState<CascadePolicy>('truncate')
  const [forkWorkspaceId, setForkWorkspaceId] = useState('')
  const [forkPresetId, setForkPresetId] = useState('')
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [draft, setDraft] = useState<{ signature: string; rows: DraftRow[] } | null>(null)
  const [history, setHistory] = useState<DraftRow[][]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<{ key: string; position: 'top' | 'bottom' } | null>(null)
  const [dragOverSection, setDragOverSection] = useState<{ id: string; position: 'top' | 'bottom' } | null>(null)
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set())
  const [touchDragState, setTouchDragState] = useState<TouchDragState | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const currentWorkspace = useMemo(
    () => workspaceItems.find(workspace => workspace.sessionIds.includes(sessionId)),
    [workspaceItems, sessionId],
  )
  const selectedForkWorkspaceId = forkWorkspaceId

  useEffect(() => {
    const release = acquire()
    load()
    return release
  }, [acquire, load])

  const timeline = state.timeline
  const presetItems = timeline?.presets ?? []
  const sourcePreset = timeline?.agentPreset ?? null
  const sourcePresetRow = sourcePreset === null
    ? undefined
    : presetItems.find(preset => preset.id === sourcePreset)
  const sourcePresetLabel = sourcePresetRow?.name ?? sourcePreset ?? '未设置'
  const baseline = useMemo(
    () => new Map((timeline?.messages ?? []).map(message => [message.key, message] as const)),
    [timeline],
  )
  const baselineRows = useMemo<DraftRow[]>(
    () => (timeline?.messages ?? []).map(message => ({
      key: message.key,
      kind: message.kind,
      text: message.text,
      turn: message.turn,
      added: false,
      ...message.toolName !== undefined ? { toolName: message.toolName } : {},
      ...message.callId !== undefined ? { callId: message.callId } : {},
      sourceEventSeq: message.eventSeq,
      sourceBlockIndex: message.blockIndex,
    })),
    [timeline],
  )
  /** Identity of the loaded history; a change means the user switched versions
   * or new turns finalized, so the local draft re-syncs from the baseline. */
  const signature = useMemo(
    () => timeline === null
      ? ''
      : `${timeline.sessionId}|${timeline.messages.map(message => message.key).join(',')}`,
    [timeline],
  )
  const lastSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    setDraft(current => current?.signature === signature
      ? current
      : { signature, rows: baselineRows })
    setHistory([])
    const sessionChanged = lastSessionIdRef.current !== timeline?.sessionId
    lastSessionIdRef.current = timeline?.sessionId ?? null
    if (sessionChanged) {
      setForkWorkspaceId('')
      setForkPresetId('')
      setSelectedKeys(new Set())
      setEditing(null)
      setCollapsedSectionIds(new Set(baselineRows.map(r => r.turn !== undefined ? `turn-${String(r.turn)}` : `added-${r.key}`)))
    }
  }, [signature, baselineRows, timeline?.sessionId])

  // Effects run after render. Do not expose the previous session's draft during
  // that gap: its provenance belongs to a different source log.
  const draftReady = draft?.signature === signature
  const rows = draftReady ? (draft?.rows ?? baselineRows) : baselineRows

  const updateDraftRows = (nextRows: DraftRow[]): void => {
    setHistory(prev => [...prev.slice(-30), rows])
    setDraft({ signature, rows: nextRows })
  }

  const undoDraft = (): void => {
    if (history.length === 0) return
    const prevRows = history[history.length - 1]
    if (!prevRows) return
    setHistory(history.slice(0, -1))
    setDraft({ signature, rows: prevRows })
    setEditing(null)
  }
  const sections = useMemo(
    () => buildSections(rows, baseline, timeline?.retryableTurns ?? []),
    [rows, baseline, timeline],
  )
  const rowsRef = useRef(rows)
  const sectionsRef = useRef(sections)
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { sectionsRef.current = sections }, [sections])
  const changes = useMemo(() => {
    let added = 0
    let edited = 0
    let deleted = 0
    const present = new Set<string>()
    for (const row of rows) {
      if (row.added) {
        added += 1
        continue
      }
      present.add(row.key)
      const original = baseline.get(row.key)
      if (original === undefined || original.text !== row.text) edited += 1
    }
    for (const key of baseline.keys()) if (!present.has(key)) deleted += 1
    return { added, edited, deleted, hasChanges: added + edited + deleted > 0 }
  }, [rows, baseline])

  const busy = state.pending !== null || state.status !== 'ready' || !draftReady

  /** Settle an added row left behind when the editor moves away: an empty
   * buffer discards the row, a filled buffer keeps it in the draft. */
  const settleAddedRow = (current: EditingState, leaving: DraftRow | undefined): void => {
    if (leaving === undefined || !leaving.added) return
    updateDraftRows(
      current.text.length === 0
        ? rows.filter(candidate => candidate.key !== current.key)
        : rows.map(candidate => candidate.key === current.key
          ? { ...candidate, text: current.text }
          : candidate),
    )
  }

  const beginEdit = (row: DraftRow): void => {
    const current = editing
    setEditing({ key: row.key, text: row.text })
    if (current === null) return
    settleAddedRow(current, rows.find(candidate => candidate.key === current.key))
  }

  const toggleSelectRow = (row: DraftRow): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(row.key)) {
        next.delete(row.key)
      } else {
        next.add(row.key)
      }
      return next
    })
  }

  const toggleSelectSection = (section: DraftSection): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      const allSelected = section.rows.every(r => prev.has(r.key))
      if (allSelected) {
        for (const r of section.rows) next.delete(r.key)
      } else {
        for (const r of section.rows) next.add(r.key)
      }
      return next
    })
  }

  const toggleSectionCollapse = (sectionId: string): void => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  const collapseAllSections = (): void => {
    setCollapsedSectionIds(new Set(sections.map(s => s.id)))
  }

  const expandAllSections = (): void => {
    setCollapsedSectionIds(new Set())
  }

  const selectAll = (): void => {
    setSelectedKeys(new Set(rows.map(row => row.key)))
  }

  const invertSelection = (): void => {
    setSelectedKeys((prev) => {
      const next = new Set<string>()
      for (const row of rows) {
        if (!prev.has(row.key)) {
          next.add(row.key)
        }
      }
      return next
    })
  }

  const clearSelection = (): void => {
    setSelectedKeys(new Set())
  }

  const deleteSelected = (): void => {
    if (selectedKeys.size === 0) return
    if (editing !== null && selectedKeys.has(editing.key)) {
      setEditing(null)
    }
    const doomed = new Set(selectedKeys)
    // For every selected user row, its whole section should be deleted
    for (const section of sections) {
      const head = section.rows[0]
      if (head !== undefined && head.kind === 'user' && doomed.has(head.key)) {
        for (const row of section.rows) {
          doomed.add(row.key)
        }
      }
    }
    updateDraftRows(rows.filter(candidate => !doomed.has(candidate.key)))
    setSelectedKeys(new Set())
  }

  const cancelEdit = (): void => {
    const current = editing
    setEditing(null)
    if (current === null) return
    const row = rows.find(candidate => candidate.key === current.key)
    if (row?.added === true) {
      updateDraftRows(rows.filter(candidate => candidate.key !== current.key))
    }
  }

  const applyEdit = (row: DraftRow, text: string): void => {
    setEditing(null)
    updateDraftRows(
      rows.map(candidate => candidate.key === row.key ? { ...candidate, text } : candidate),
    )
  }

  const touchStateRef = useRef<{
    active: boolean
    type: 'row' | 'section'
    key?: string
    sectionId?: string
    touchId: number
    lastX: number
    lastY: number
  } | null>(null)

  const dropTargetRef = useRef<{
    kind: 'card'
    key: string
    position: 'top' | 'bottom'
  } | {
    kind: 'section'
    sectionId: string
    position: 'top' | 'bottom'
  } | null>(null)

  const moveRow = (sourceKey: string, targetKey: string, position: 'top' | 'bottom'): boolean => {
    if (sourceKey === targetKey) return false
    const currentRows = [...rowsRef.current]
    const sourceIndex = currentRows.findIndex(r => r.key === sourceKey)
    const targetIndex = currentRows.findIndex(r => r.key === targetKey)
    if (sourceIndex === -1 || targetIndex === -1) return false

    const [movedRow] = currentRows.splice(sourceIndex, 1)
    if (!movedRow) return false

    let insertIndex = currentRows.findIndex(r => r.key === targetKey)
    if (position === 'bottom') {
      insertIndex += 1
    }
    currentRows.splice(insertIndex, 0, movedRow)

    updateDraftRows(currentRows)
    return true
  }

  const moveRowIntoSection = (sourceKey: string, targetSectionId: string): boolean => {
    const targetSection = sectionsRef.current.find(s => s.id === targetSectionId)
    if (!targetSection) return false
    const lastRow = targetSection.rows[targetSection.rows.length - 1]
    if (!lastRow || lastRow.key === sourceKey) return false

    const currentRows = [...rowsRef.current]
    const sourceIndex = currentRows.findIndex(r => r.key === sourceKey)
    if (sourceIndex === -1) return false

    const [movedRow] = currentRows.splice(sourceIndex, 1)
    if (!movedRow) return false

    const targetIndex = currentRows.findIndex(r => r.key === lastRow.key)
    if (targetIndex === -1) {
      currentRows.push(movedRow)
    } else {
      currentRows.splice(targetIndex + 1, 0, movedRow)
    }

    updateDraftRows(currentRows)
    return true
  }

  const moveSection = (sourceSectionId: string, targetSectionId: string, position: 'top' | 'bottom'): boolean => {
    if (sourceSectionId === targetSectionId) return false
    const currentSections = [...sectionsRef.current]
    const sourceIndex = currentSections.findIndex(s => s.id === sourceSectionId)
    const targetIndex = currentSections.findIndex(s => s.id === targetSectionId)
    if (sourceIndex === -1 || targetIndex === -1) return false

    const [movedSection] = currentSections.splice(sourceIndex, 1)
    if (!movedSection) return false

    let insertIndex = currentSections.findIndex(s => s.id === targetSectionId)
    if (position === 'bottom') {
      insertIndex += 1
    }
    currentSections.splice(insertIndex, 0, movedSection)

    const reorderedRows = currentSections.flatMap(s => s.rows)
    updateDraftRows(reorderedRows)
    return true
  }

  const handleDragStart = (row: DraftRow): void => {
    setDraggingKey(row.key)
    setDraggingSectionId(null)
  }

  const handleSectionDragStart = (section: DraftSection): void => {
    setDraggingSectionId(section.id)
    setDraggingKey(null)
  }

  const handleDragEnd = (): void => {
    setDraggingKey(null)
    setDraggingSectionId(null)
    setDragOverTarget(null)
    setDragOverSection(null)
  }

  const animFrameIdRef = useRef<number | null>(null)
  const autoScrollTargetRef = useRef<{ clientY: number } | null>(null)

  const performAutoScroll = (clientY: number): void => {
    let scrollEl: HTMLElement | null = rootRef.current?.parentElement ?? null
    while (scrollEl && scrollEl !== document.body && scrollEl !== document.documentElement) {
      if (scrollEl.scrollHeight > scrollEl.clientHeight) {
        const overflow = getComputedStyle(scrollEl).overflowY
        if (overflow === 'auto' || overflow === 'scroll') break
      }
      scrollEl = scrollEl.parentElement
    }
    if (!scrollEl) scrollEl = document.querySelector('[data-conversation-scroll]') as HTMLElement | null
    if (!scrollEl) scrollEl = document.querySelector('.wSkVaW_scrollBody') as HTMLElement | null
    if (!scrollEl) scrollEl = (document.scrollingElement as HTMLElement | null) ?? document.documentElement
    if (!scrollEl) return

    const isDoc = scrollEl === document.documentElement || scrollEl === document.body
    const rect = isDoc
      ? { top: 0, bottom: window.innerHeight }
      : scrollEl.getBoundingClientRect()

    const composerSeat = document.querySelector('.wSkVaW_composerSeat') as HTMLElement | null
    const effectiveBottom = composerSeat ? composerSeat.getBoundingClientRect().top : rect.bottom
    const effectiveTop = rect.top

    const threshold = 100
    const maxSpeed = 35

    let delta = 0
    if (clientY < effectiveTop + threshold) {
      const ratio = Math.max(0.15, (effectiveTop + threshold - clientY) / threshold)
      delta = -Math.round(maxSpeed * ratio)
    } else if (clientY > effectiveBottom - threshold) {
      const ratio = Math.max(0.15, (clientY - (effectiveBottom - threshold)) / threshold)
      delta = Math.round(maxSpeed * ratio)
    }

    if (delta !== 0) {
      if (isDoc) {
        window.scrollBy(0, delta)
      } else {
        scrollEl.scrollTop += delta
      }
    }
  }

  const startAutoScrollLoop = (): void => {
    if (animFrameIdRef.current !== null) return
    const loop = (): void => {
      if (autoScrollTargetRef.current !== null) {
        performAutoScroll(autoScrollTargetRef.current.clientY)
        const cur = touchStateRef.current
        if (cur && cur.active) {
          updateTouchDropTarget(cur.lastX, cur.lastY)
        }
        animFrameIdRef.current = requestAnimationFrame(loop)
      } else {
        animFrameIdRef.current = null
      }
    }
    animFrameIdRef.current = requestAnimationFrame(loop)
  }

  const stopAutoScrollLoop = (): void => {
    autoScrollTargetRef.current = null
    if (animFrameIdRef.current !== null) {
      cancelAnimationFrame(animFrameIdRef.current)
      animFrameIdRef.current = null
    }
  }

  const updateTouchDropTarget = (clientX: number, clientY: number): void => {
    const cur = touchStateRef.current
    if (!cur || !cur.active) return

    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    if (!element) return

    if (cur.type === 'row' && cur.key) {
      const targetCardEl = element.closest('[data-message-key]') as HTMLElement | null
      const targetKey = targetCardEl?.getAttribute('data-message-key')
      if (targetCardEl && targetKey && targetKey !== cur.key) {
        const rect = targetCardEl.getBoundingClientRect()
        const position = clientY - rect.top < rect.height / 2 ? 'top' : 'bottom'
        setDragOverTarget({ key: targetKey, position })
        setDragOverSection(null)
        dropTargetRef.current = { kind: 'card', key: targetKey, position }
        return
      }

      const targetSecEl = element.closest('[data-section-id]') as HTMLElement | null
      const targetSecId = targetSecEl?.getAttribute('data-section-id')
      if (targetSecEl && targetSecId) {
        setDragOverTarget(null)
        setDragOverSection({ id: targetSecId, position: 'bottom' })
        dropTargetRef.current = { kind: 'section', sectionId: targetSecId, position: 'bottom' }
        return
      }

      setDragOverTarget(null)
      setDragOverSection(null)
      dropTargetRef.current = null
    } else if (cur.type === 'section' && cur.sectionId) {
      const targetSecEl = element.closest('[data-section-id]') as HTMLElement | null
      const targetSecId = targetSecEl?.getAttribute('data-section-id')
      if (targetSecEl && targetSecId && targetSecId !== cur.sectionId) {
        const rect = targetSecEl.getBoundingClientRect()
        const position = clientY - rect.top < rect.height / 2 ? 'top' : 'bottom'
        setDragOverSection({ id: targetSecId, position })
        setDragOverTarget(null)
        dropTargetRef.current = { kind: 'section', sectionId: targetSecId, position }
        return
      }

      setDragOverTarget(null)
      setDragOverSection(null)
      dropTargetRef.current = null
    }
  }

  const isTouchBoundRef = useRef(false)

  const onWindowTouchMove = (e: TouchEvent): void => {
    const cur = touchStateRef.current
    if (!cur || !cur.active) return
    const touch = Array.from(e.touches).find(t => t.identifier === cur.touchId)
    if (!touch) return
    if (e.cancelable) e.preventDefault()

    cur.lastX = touch.clientX
    cur.lastY = touch.clientY
    autoScrollTargetRef.current = { clientY: touch.clientY }

    setTouchDragState(prev => prev ? {
      ...prev,
      currentX: touch.clientX,
      currentY: touch.clientY,
    } : null)

    updateTouchDropTarget(touch.clientX, touch.clientY)
  }

  const endTouchDrag = (): void => {
    stopAutoScrollLoop()
    unbindWindowTouchEvents()

    const cur = touchStateRef.current
    const target = dropTargetRef.current
    touchStateRef.current = null
    dropTargetRef.current = null

    if (cur && cur.active && target) {
      if (cur.type === 'row' && cur.key) {
        if (target.kind === 'card') {
          moveRow(cur.key, target.key, target.position)
        } else if (target.kind === 'section') {
          moveRowIntoSection(cur.key, target.sectionId)
        }
      } else if (cur.type === 'section' && cur.sectionId) {
        if (target.kind === 'section') {
          moveSection(cur.sectionId, target.sectionId, target.position)
        }
      }
    }

    setDraggingKey(null)
    setDraggingSectionId(null)
    setDragOverTarget(null)
    setDragOverSection(null)
    setTouchDragState(null)
  }

  const cancelTouchDrag = (): void => {
    stopAutoScrollLoop()
    unbindWindowTouchEvents()
    touchStateRef.current = null
    dropTargetRef.current = null
    setDraggingKey(null)
    setDraggingSectionId(null)
    setDragOverTarget(null)
    setDragOverSection(null)
    setTouchDragState(null)
  }

  const bindWindowTouchEvents = (): void => {
    if (isTouchBoundRef.current) return
    isTouchBoundRef.current = true
    window.addEventListener('touchmove', onWindowTouchMove, { passive: false })
    window.addEventListener('touchend', endTouchDrag, { passive: true })
    window.addEventListener('touchcancel', cancelTouchDrag, { passive: true })
  }

  const unbindWindowTouchEvents = (): void => {
    if (!isTouchBoundRef.current) return
    isTouchBoundRef.current = false
    window.removeEventListener('touchmove', onWindowTouchMove)
    window.removeEventListener('touchend', endTouchDrag)
    window.removeEventListener('touchcancel', cancelTouchDrag)
  }

  useEffect(() => {
    return () => {
      stopAutoScrollLoop()
      unbindWindowTouchEvents()
    }
  }, [])

  const handleRowTouchStart = (e: React.TouchEvent<HTMLElement>, row: DraftRow): void => {
    if (busy || e.touches.length !== 1) return
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return

    touchStateRef.current = {
      active: true,
      type: 'row',
      key: row.key,
      touchId: touch.identifier,
      lastX: touch.clientX,
      lastY: touch.clientY,
    }
    dropTargetRef.current = null
    autoScrollTargetRef.current = { clientY: touch.clientY }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(25) } catch {}
    }

    setDraggingKey(row.key)
    setDraggingSectionId(null)
    const badge = row.kind === 'tool.call' && row.toolName
      ? `工具调用: ${row.toolName}`
      : BLOCK_LABEL[row.kind] || row.kind
    setTouchDragState({
      type: 'row',
      key: row.key,
      badge,
      preview: row.text.slice(0, 30) || '（空内容）',
      currentX: touch.clientX,
      currentY: touch.clientY,
    })

    startAutoScrollLoop()
    bindWindowTouchEvents()
  }

  const handleSectionTouchStart = (e: React.TouchEvent<HTMLElement>, section: DraftSection): void => {
    if (busy || e.touches.length !== 1) return
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return

    touchStateRef.current = {
      active: true,
      type: 'section',
      sectionId: section.id,
      touchId: touch.identifier,
      lastX: touch.clientX,
      lastY: touch.clientY,
    }
    dropTargetRef.current = null
    autoScrollTargetRef.current = { clientY: touch.clientY }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(25) } catch {}
    }

    setDraggingSectionId(section.id)
    setDraggingKey(null)
    setTouchDragState({
      type: 'section',
      sectionId: section.id,
      badge: section.turnLabel,
      preview: section.preview.slice(0, 30) || '（空内容）',
      currentX: touch.clientX,
      currentY: touch.clientY,
    })

    startAutoScrollLoop()
    bindWindowTouchEvents()
  }

  const handleDragOver = (event: React.DragEvent<HTMLElement>, targetRow: DraftRow): void => {
    if (draggingKey === null || draggingKey === targetRow.key) return
    event.preventDefault()
    performAutoScroll(event.clientY)
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = event.clientY - rect.top
    const position = offset < rect.height / 2 ? 'top' : 'bottom'
    if (dragOverTarget?.key !== targetRow.key || dragOverTarget.position !== position) {
      setDragOverTarget({ key: targetRow.key, position })
    }
  }

  const handleSectionDragOver = (event: React.DragEvent<HTMLElement>, targetSection: DraftSection): void => {
    performAutoScroll(event.clientY)
    if (draggingSectionId !== null) {
      if (draggingSectionId === targetSection.id) return
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const offset = event.clientY - rect.top
      const position = offset < rect.height / 2 ? 'top' : 'bottom'
      if (dragOverSection?.id !== targetSection.id || dragOverSection.position !== position) {
        setDragOverSection({ id: targetSection.id, position })
      }
      return
    }
    if (draggingKey !== null) {
      event.preventDefault()
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLElement>, targetRow: DraftRow): void => {
    event.preventDefault()
    event.stopPropagation()
    const sourceKey = draggingKey || event.dataTransfer.getData('text/plain')
    if (!sourceKey || sourceKey === targetRow.key) {
      handleDragEnd()
      return
    }

    let position = dragOverTarget?.position
    if (!position || dragOverTarget?.key !== targetRow.key) {
      const rect = event.currentTarget.getBoundingClientRect()
      const offset = event.clientY - rect.top
      position = offset < rect.height / 2 ? 'top' : 'bottom'
    }

    moveRow(sourceKey, targetRow.key, position)
    handleDragEnd()
  }

  const handleSectionDrop = (event: React.DragEvent<HTMLElement>, targetSection: DraftSection): void => {
    event.preventDefault()
    event.stopPropagation()

    // 1. Reordering whole sections
    if (draggingSectionId !== null) {
      if (draggingSectionId === targetSection.id) {
        handleDragEnd()
        return
      }
      let position = dragOverSection?.position
      if (!position || dragOverSection?.id !== targetSection.id) {
        const rect = event.currentTarget.getBoundingClientRect()
        const offset = event.clientY - rect.top
        position = offset < rect.height / 2 ? 'top' : 'bottom'
      }
      moveSection(draggingSectionId, targetSection.id, position)
      handleDragEnd()
      return
    }

    // 2. Dropping single row into section
    const sourceKey = draggingKey || event.dataTransfer.getData('text/plain')
    if (sourceKey) {
      moveRowIntoSection(sourceKey, targetSection.id)
    }
    handleDragEnd()
  }

  const deleteRow = (row: DraftRow): void => {
    if (editing?.key === row.key) setEditing(null)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      next.delete(row.key)
      return next
    })
    if (row.kind !== 'user') {
      updateDraftRows(rows.filter(candidate => candidate.key !== row.key))
      return
    }
    const section = sections.find(
      candidate => candidate.rows.some(candidateRow => candidateRow.key === row.key),
    )
    const doomed = new Set(section?.rows.map(candidateRow => candidateRow.key) ?? [row.key])
    updateDraftRows(rows.filter(candidate => !doomed.has(candidate.key)))
  }

  const addRow = (kind: EditableBlockKind, afterKey: string | null): void => {
    const row = addedRow(kind)
    const next: DraftRow[] = [...rows]
    if (afterKey === null) {
      next.push(row)
    } else {
      const index = next.findIndex(candidate => candidate.key === afterKey)
      next.splice(index === -1 ? next.length : index + 1, 0, row)
    }
    updateDraftRows(next)
    setEditing({ key: row.key, text: '' })
  }

  const resetDraft = (): void => {
    setEditing(null)
    setSelectedKeys(new Set())
    setDraft({ signature, rows: baselineRows })
  }

  const hasSelection = selectedKeys.size > 0
  const activeRows = useMemo(() => {
    if (!hasSelection) return rows
    return rows.filter(r => selectedKeys.has(r.key))
  }, [rows, selectedKeys, hasSelection])

  const forkRows = (): ForkMessageRow[] =>
    activeRows.map(row => ({
      kind: row.kind,
      text: row.text,
      ...row.toolName ? { toolName: row.toolName } : {},
      ...row.callId ? { callId: row.callId } : {},
      ...row.sourceEventSeq !== undefined ? { sourceEventSeq: row.sourceEventSeq } : {},
      ...row.sourceBlockIndex !== undefined ? { sourceBlockIndex: row.sourceBlockIndex } : {},
    }))

  const lastActiveRow = activeRows[activeRows.length - 1]
  const forkLabel = state.pending === 'fork'
    ? '正在 Fork…'
    : hasSelection
      ? lastActiveRow === undefined
        ? 'Fork 选中消息 (0)'
        : lastActiveRow.kind === 'user'
          ? `Fork 选中项并回复 (${selectedKeys.size})`
          : `Fork 选中项 (${selectedKeys.size})`
      : lastActiveRow === undefined
        ? 'Fork 空白历史'
        : lastActiveRow.kind === 'user'
          ? 'Fork 生成回复'
          : 'Fork（不生成回复）'

  if (timeline === null || state.status === 'error') {
    return (
      <section className={styles['status']}>
        {state.status === 'loading' ? <p>正在加载会话时间线…</p> : null}
        {state.status === 'error' && state.error !== null ? <p className={styles['error']}>{state.error}</p> : null}
        {state.status === 'idle' ? <p>正在等待会话时间线…</p> : null}
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={state.status === 'loading'}
          onClick={() => { void load() }}
        >
          重新加载
        </button>
      </section>
    )
  }

  return (
    <div
      ref={rootRef}
      className={styles['root']}
      data-touch-dragging={touchDragState !== null || undefined}
    >
      <header className={styles['pageHeader']}>
        <div>
          <h1 className={styles['title']}>消息编辑与重生成</h1>
          <p className={styles['intro']}>
            在右列自由增删改已落定消息，Fork 按当前内容重建消息历史并生成新版本；可在顶部选择目标工作区。
            以用户消息结尾时，新版本会生成新的助手回复。每次修改与其恢复版本成对记录，原版本保持不变。
          </p>
        </div>
        <div className={styles['headerActions']}>
          <div className={styles['actionRow']}>
            <label className={styles['cascadeField']}>
              <span>重试后续策略</span>
              <select
                className={styles['select']}
                value={cascade}
                onChange={(event) => { setCascade(event.currentTarget.value as CascadePolicy) }}
              >
                <option value="truncate">截断后续回合</option>
                <option value="preserve">保留后续用户输入</option>
              </select>
            </label>
            <button
              type="button"
              className={styles['primaryButton']}
              disabled={busy || editing !== null || (!changes.hasChanges && !hasSelection && selectedForkWorkspaceId === '' && forkPresetId === '')}
              title={hasSelection
                ? '基于当前选中的消息列表重建新版本历史'
                : selectedForkWorkspaceId !== ''
                  ? '按当前历史 Fork 到目标工作区'
                  : forkPresetId !== ''
                    ? '按当前历史 Fork 并使用选定的 DSH preset'
                    : '按右列当前内容重建消息历史并生成新版本；结尾的用户消息会触发新的助手回复'}
              onClick={() => { void fork(
                forkRows(),
                selectedForkWorkspaceId || undefined,
                forkPresetId || undefined,
              ) }}
            >
              {forkLabel}
            </button>
            <button
              type="button"
              className={styles['secondaryButton']}
              disabled={busy}
              onClick={() => { void reroll() }}
            >
              {state.pending === 'reroll' ? '正在重生成…' : '重生成最后回复'}
            </button>
          </div>
          <label className={`${styles['cascadeField']} ${styles['workspaceField']}`}>
            <span>Fork 目标工作区</span>
            <select
              className={`${styles['select']} ${styles['workspaceSelect']}`}
              value={selectedForkWorkspaceId}
              disabled={busy}
              onChange={(event) => { setForkWorkspaceId(event.currentTarget.value) }}
            >
              <option value="">
                {currentWorkspace === undefined ? '沿用源会话工作目录' : `跟随当前工作区：${currentWorkspace.title}`}
              </option>
              {workspaceItems.map(workspace => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.title} · {workspace.path}
                </option>
              ))}
            </select>
          </label>
          <label className={`${styles['cascadeField']} ${styles['workspaceField']}`}>
            <span>Fork 使用 DSH preset</span>
            <select
              className={`${styles['select']} ${styles['workspaceSelect']}`}
              value={forkPresetId}
              disabled={busy}
              onChange={(event) => { setForkPresetId(event.currentTarget.value) }}
            >
              <option value="">沿用源会话：{sourcePresetLabel}</option>
              {presetItems.map(preset => (
                <option key={preset.id} value={preset.id} disabled={preset.broken !== undefined}>
                  {preset.name ?? preset.id}{preset.isDefault ? ' · 默认' : ''}{preset.broken === undefined ? '' : ' · 不可用'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {state.error === null ? null : <p className={styles['error']}>{state.error}</p>}
      {state.status === 'loading' ? <p className={styles['notice']}>正在刷新时间线…</p> : null}

      <div className={styles['columns']}>
        <aside className={styles['versionsPanel']}>
          <div className={styles['sectionHeading']}>
            <h2 className={styles['subtitle']}>版本时间线</h2>
            <span className={styles['count']}>{String(timeline.versions.length)}</span>
          </div>
          {timeline.versions.length === 0
            ? <p className={styles['empty']}>当前会话还没有可记录的版本。</p>
            : (
              <ol className={styles['versionList']}>
                {timeline.versions.map(version => (
                  <VersionRow
                    key={version.sessionId}
                    version={version}
                    disabled={busy}
                    onOpen={(sessionId) => { void openVersion(sessionId) }}
                  />
                ))}
              </ol>
            )}
        </aside>
        <main className={styles['turnsPanel']}>
          <div className={styles['sectionHeading']}>
            <h2 className={styles['subtitle']}>已落定消息</h2>
            <div className={styles['batchActions']}>
              {sections.length > 0 && (
                <>
                  <button
                    type="button"
                    className={styles['textButton']}
                    disabled={busy}
                    title="展开所有历史回合"
                    onClick={expandAllSections}
                  >
                    展开全部
                  </button>
                  <button
                    type="button"
                    className={styles['textButton']}
                    disabled={busy}
                    title="收起所有历史回合"
                    onClick={collapseAllSections}
                  >
                    收起全部
                  </button>
                </>
              )}
              {rows.length > 0 && (
                <>
                  <button
                    type="button"
                    className={styles['textButton']}
                    disabled={busy}
                    title="全选所有消息"
                    onClick={selectAll}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className={styles['textButton']}
                    disabled={busy}
                    title="反向选择消息"
                    onClick={invertSelection}
                  >
                    反选
                  </button>
                  {selectedKeys.size > 0 && (
                    <>
                      <button
                        type="button"
                        className={styles['textButton']}
                        disabled={busy}
                        title="取消所有选择"
                        onClick={clearSelection}
                      >
                        取消选择
                      </button>
                      <button
                        type="button"
                        className={styles['textButton']}
                        data-danger
                        disabled={busy}
                        title="批量删除选中的消息"
                        onClick={deleteSelected}
                      >
                        删除选中 ({selectedKeys.size})
                      </button>
                    </>
                  )}
                </>
              )}
              {changes.hasChanges
                ? (
                  <span className={styles['changeSummary']}>
                    <span className={styles['changeChip']}>{changeSummaryText(changes)}</span>
                    {history.length > 0 && (
                      <button
                        type="button"
                        className={styles['textButton']}
                        disabled={busy}
                        title="撤销最近一次草稿修改"
                        onClick={undoDraft}
                      >
                        撤销修改
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles['textButton']}
                      disabled={busy}
                      title="重置全部草稿回原始版本"
                      onClick={resetDraft}
                    >
                      重置
                    </button>
                  </span>
                )
                : (
                  <>
                    {history.length > 0 && (
                      <button
                        type="button"
                        className={styles['textButton']}
                        disabled={busy}
                        title="撤销最近一次草稿修改"
                        onClick={undoDraft}
                      >
                        撤销修改
                      </button>
                    )}
                    <span className={styles['count']}>{String(timeline.messages.length)}</span>
                  </>
                )}
            </div>
          </div>
          {sections.length === 0
            ? (
              <div className={styles['emptyState']}>
                <p className={styles['empty']}>
                  {baseline.size === 0
                    ? '当前会话还没有已落定消息。'
                    : '所有消息都已删除；Fork 将创建一个空白历史分支。'}
                </p>
                <button
                  type="button"
                  className={styles['secondaryButton']}
                  disabled={busy}
                  onClick={() => { addRow('user', null) }}
                >
                  ＋ 添加用户消息
                </button>
              </div>
            )
            : (
              <>
                <ol className={styles['turnList']}>
                  {sections.map((section) => {
                    const retryTurn = section.retry
                    const tailKey = section.rows[section.rows.length - 1]?.key
                    const isCollapsed = collapsedSectionIds.has(section.id)
                    return (
                    <li
                      key={section.id}
                      className={styles['turnSection']}
                      data-section-id={section.id}
                      data-collapsed={isCollapsed || undefined}
                      data-dragging={draggingSectionId === section.id || undefined}
                      data-drag-over-top={dragOverSection?.id === section.id && dragOverSection.position === 'top' || undefined}
                      data-drag-over-bottom={dragOverSection?.id === section.id && dragOverSection.position === 'bottom' || undefined}
                      onDragOver={(e) => { handleSectionDragOver(e, section) }}
                      onDrop={(e) => { handleSectionDrop(e, section) }}
                    >
                      <div
                        className={styles['turnHeader']}
                        onClick={(e) => {
                          const target = e.target as HTMLElement | null
                          if (target && (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.closest('button') || target.closest(`.${styles['dragHandle']}`))) {
                            return
                          }
                          toggleSectionCollapse(section.id)
                        }}
                      >
                        <div className={styles['turnHeaderLeft']}>
                          <button
                            type="button"
                            className={styles['collapseTurnButton']}
                            title={isCollapsed ? '展开此回合' : '收起此回合'}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleSectionCollapse(section.id)
                            }}
                          >
                            {isCollapsed ? '▶' : '▼'}
                          </button>
                          {!busy && (
                            <span
                              className={styles['dragHandle']}
                              draggable
                              data-active={draggingSectionId === section.id || undefined}
                              title="按住拖拽移动整个回合"
                              onTouchStart={(e) => { handleSectionTouchStart(e, section) }}
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = 'move'
                                e.dataTransfer.setData('text/plain', `section:${section.id}`)
                                handleSectionDragStart(section)
                              }}
                              onDragEnd={handleDragEnd}
                            >
                              <DragGripIcon />
                            </span>
                          )}
                          <input
                            type="checkbox"
                            className={styles['checkbox']}
                            checked={section.rows.length > 0 && section.rows.every(r => selectedKeys.has(r.key))}
                            ref={(el) => {
                              if (el) {
                                const count = section.rows.filter(r => selectedKeys.has(r.key)).length
                                el.indeterminate = count > 0 && count < section.rows.length
                              }
                            }}
                            disabled={busy}
                            title="选择/取消选择该回合下的所有消息"
                            onChange={() => { toggleSelectSection(section) }}
                            onClick={(e) => { e.stopPropagation() }}
                          />
                          <h3 className={styles['turnTitle']}>{section.turnLabel}</h3>
                          <span className={styles['turnPreview']}>{section.preview || '（空内容）'}</span>
                        </div>
                        <div className={styles['turnActions']}>
                          {retryTurn === undefined ? null : (
                            <button
                              type="button"
                              className={styles['secondaryButton']}
                              disabled={busy}
                              onClick={() => { void retry(retryTurn.turn, cascade) }}
                            >
                              {state.pending === 'retry' ? '正在重试…' : '重试此回合'}
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles['secondaryButton']}
                            disabled={busy}
                            title="在此回合之后插入一条新的用户消息"
                            onClick={() => { if (tailKey !== undefined) addRow('user', tailKey) }}
                          >
                            ＋ 用户消息
                          </button>
                          <button
                            type="button"
                            className={styles['secondaryButton']}
                            disabled={busy}
                            title="为此回合追加一条助手回复"
                            onClick={() => { if (tailKey !== undefined) addRow('assistant.response', tailKey) }}
                          >
                            ＋ 助手回复
                          </button>
                        </div>
                      </div>
                      {!isCollapsed && (
                      <div className={styles['messageList']}>
                        {section.rows.map(row => (
                          <MessageCard
                            key={row.key}
                            row={row}
                            baseline={baseline.get(row.key)}
                            editing={editing}
                            selected={selectedKeys.has(row.key)}
                            disabled={busy}
                            isDragging={draggingKey === row.key}
                            dragOverPosition={dragOverTarget?.key === row.key ? dragOverTarget.position : null}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            onTouchStart={handleRowTouchStart}
                            onSelectToggle={toggleSelectRow}
                            onBeginEdit={beginEdit}
                            onCancelEdit={cancelEdit}
                            onTextChange={(text) => {
                              setEditing(current => current === null ? null : { ...current, text })
                            }}
                            onApplyEdit={applyEdit}
                            onDelete={deleteRow}
                          />
                        ))}
                      </div>
                      )}
                    </li>
                    )
                  })}
                </ol>
                <div className={styles['composerFooter']}>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    disabled={busy}
                    onClick={() => { addRow('user', null) }}
                  >
                    ＋ 在末尾添加用户消息
                  </button>
                </div>
              </>
            )}
        </main>
      </div>

      {touchDragState !== null && (
        <div
          className={styles['touchDragGhost']}
          style={{
            transform: `translate3d(${Math.max(10, Math.min((typeof window !== 'undefined' ? window.innerWidth : 400) - 240, touchDragState.currentX - 40))}px, ${touchDragState.currentY > 70 ? touchDragState.currentY - 55 : touchDragState.currentY + 25}px, 0)`,
          }}
        >
          <DragGripIcon />
          <span className={styles['touchDragGhostKind']}>{touchDragState.badge}</span>
          {touchDragState.preview ? (
            <span className={styles['touchDragGhostPreview']}>{touchDragState.preview}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}
