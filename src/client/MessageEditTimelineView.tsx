/** Timeline tab: durable version tree plus free CRUD over finalized messages,
 * committed as a forked version that regenerates replies. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CascadePolicy,
  EditableBlockKind,
  EditableMessageBlock,
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
  onSelectToggle: (row: DraftRow) => void
  onBeginEdit: (row: DraftRow) => void
  onCancelEdit: () => void
  onTextChange: (text: string) => void
  onApplyEdit: (row: DraftRow, text: string) => void
  onDelete: (row: DraftRow) => void
}): ReactNode {
  const active = editing?.key === row.key
  const edited = !row.added && baseline !== undefined && baseline.text !== row.text

  const badgeLabel = BLOCK_LABEL[row.kind] || row.kind
  const kindDataAttr = row.kind.replace('.', '-')

  // Default collapse all multi-line items or long responses, tool calls, tool results, and system prompts
  const isMultiLine = row.text.includes('\n') || row.text.length > 70
  const defaultCollapsed = isMultiLine && row.kind !== 'assistant.reasoning'
  const [expanded, setExpanded] = useState<boolean>(!defaultCollapsed)

  return (
    <article
      className={styles['messageCard']}
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
                title="按住拖拽排序"
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', row.key)
                  onDragStart?.(row)
                }}
                onDragEnd={() => { onDragEnd?.() }}
              >
                ⋮⋮
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
}: MessageEditTimelineViewProps): ReactNode {
  const state = useMessageEdit(value => value)
  const [cascade, setCascade] = useState<CascadePolicy>('truncate')
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [draft, setDraft] = useState<{ signature: string; rows: DraftRow[] } | null>(null)
  const [history, setHistory] = useState<DraftRow[][]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<{ key: string; position: 'top' | 'bottom' } | null>(null)
  const [dragOverSection, setDragOverSection] = useState<{ id: string; position: 'top' | 'bottom' } | null>(null)
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const release = acquire()
    load()
    return release
  }, [acquire, load])

  const timeline = state.timeline
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

  useEffect(() => {
    setDraft(current => current?.signature === signature
      ? current
      : { signature, rows: baselineRows })
    setHistory([])
  }, [signature, baselineRows])

  const rows = draft?.rows ?? baselineRows

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

  const busy = state.pending !== null || state.status !== 'ready'

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

  const autoScroll = (event: React.DragEvent<HTMLElement>): void => {
    let scrollEl: HTMLElement | null = event.currentTarget.parentElement
    while (scrollEl && scrollEl !== document.body) {
      if (scrollEl.scrollHeight > scrollEl.clientHeight) {
        const overflow = getComputedStyle(scrollEl).overflowY
        if (overflow === 'auto' || overflow === 'scroll') break
      }
      scrollEl = scrollEl.parentElement
    }
    if (!scrollEl) scrollEl = document.querySelector('.wSkVaW_scrollBody') as HTMLElement | null
    if (!scrollEl) return

    const rect = scrollEl.getBoundingClientRect()
    // The bottom of the visible scroll area is cut off by the composer seat (about 130px)
    const composerSeat = document.querySelector('.wSkVaW_composerSeat') as HTMLElement | null
    const effectiveBottom = composerSeat ? composerSeat.getBoundingClientRect().top : rect.bottom

    const threshold = 120
    const maxSpeed = 50

    if (event.clientY < rect.top + threshold) {
      const ratio = Math.max(0.2, (rect.top + threshold - event.clientY) / threshold)
      scrollEl.scrollTop -= Math.round(maxSpeed * ratio)
    } else if (event.clientY > effectiveBottom - threshold) {
      const ratio = Math.max(0.2, (event.clientY - (effectiveBottom - threshold)) / threshold)
      scrollEl.scrollTop += Math.round(maxSpeed * ratio)
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLElement>, targetRow: DraftRow): void => {
    if (draggingKey === null || draggingKey === targetRow.key) return
    event.preventDefault()
    autoScroll(event)
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = event.clientY - rect.top
    const position = offset < rect.height / 2 ? 'top' : 'bottom'
    if (dragOverTarget?.key !== targetRow.key || dragOverTarget.position !== position) {
      setDragOverTarget({ key: targetRow.key, position })
    }
  }

  const handleSectionDragOver = (event: React.DragEvent<HTMLElement>, targetSection: DraftSection): void => {
    autoScroll(event)
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

    const currentRows = [...rows]
    const sourceIndex = currentRows.findIndex(r => r.key === sourceKey)
    const targetIndex = currentRows.findIndex(r => r.key === targetRow.key)
    if (sourceIndex === -1 || targetIndex === -1) {
      handleDragEnd()
      return
    }

    const [movedRow] = currentRows.splice(sourceIndex, 1)
    if (!movedRow) {
      handleDragEnd()
      return
    }

    // Recalculate targetIndex after removing the source item
    let insertIndex = currentRows.findIndex(r => r.key === targetRow.key)
    if (position === 'bottom') {
      insertIndex += 1
    }
    currentRows.splice(insertIndex, 0, movedRow)

    updateDraftRows(currentRows)
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

      const sourceSectionIndex = sections.findIndex(s => s.id === draggingSectionId)
      const targetSectionIndex = sections.findIndex(s => s.id === targetSection.id)
      if (sourceSectionIndex === -1 || targetSectionIndex === -1) {
        handleDragEnd()
        return
      }

      let position = dragOverSection?.position
      if (!position || dragOverSection?.id !== targetSection.id) {
        const rect = event.currentTarget.getBoundingClientRect()
        const offset = event.clientY - rect.top
        position = offset < rect.height / 2 ? 'top' : 'bottom'
      }

      const newSections = [...sections]
      const [movedSection] = newSections.splice(sourceSectionIndex, 1)
      if (!movedSection) {
        handleDragEnd()
        return
      }

      let insertIndex = newSections.findIndex(s => s.id === targetSection.id)
      if (position === 'bottom') {
        insertIndex += 1
      }
      newSections.splice(insertIndex, 0, movedSection)

      // Flatten reordered sections back to rows
      const reorderedRows = newSections.flatMap(s => s.rows)
      updateDraftRows(reorderedRows)
      handleDragEnd()
      return
    }

    // 2. Dropping single row into section
    const sourceKey = draggingKey || event.dataTransfer.getData('text/plain')
    if (!sourceKey) {
      handleDragEnd()
      return
    }
    const lastRow = targetSection.rows[targetSection.rows.length - 1]
    if (!lastRow || lastRow.key === sourceKey) {
      handleDragEnd()
      return
    }

    const currentRows = [...rows]
    const sourceIndex = currentRows.findIndex(r => r.key === sourceKey)
    if (sourceIndex === -1) {
      handleDragEnd()
      return
    }

    const [movedRow] = currentRows.splice(sourceIndex, 1)
    if (!movedRow) {
      handleDragEnd()
      return
    }

    const targetIndex = currentRows.findIndex(r => r.key === lastRow.key)
    if (targetIndex === -1) {
      currentRows.push(movedRow)
    } else {
      currentRows.splice(targetIndex + 1, 0, movedRow)
    }

    updateDraftRows(currentRows)
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

  const forkRows = (): { kind: EditableBlockKind; text: string }[] =>
    rows.map(row => ({ kind: row.kind, text: row.text }))

  const lastRow = rows[rows.length - 1]
  const forkLabel = state.pending === 'fork'
    ? '正在 Fork…'
    : lastRow === undefined
      ? 'Fork 空白历史'
      : lastRow.kind === 'user'
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
    <div className={styles['root']}>
      <header className={styles['pageHeader']}>
        <div>
          <h1 className={styles['title']}>消息编辑与重生成</h1>
          <p className={styles['intro']}>
            在右列自由增删改已落定消息，Fork 按当前内容重建消息历史并生成新版本；以用户消息结尾时，
            新版本会生成新的助手回复。每次修改与其恢复版本成对记录，原版本保持不变。
          </p>
        </div>
        <div className={styles['headerActions']}>
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
            disabled={busy || editing !== null || !changes.hasChanges}
            title="按右列当前内容重建消息历史并生成新版本；结尾的用户消息会触发新的助手回复"
            onClick={() => { void fork(forkRows()) }}
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
                              title="按住拖拽移动整个回合"
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = 'move'
                                e.dataTransfer.setData('text/plain', `section:${section.id}`)
                                handleSectionDragStart(section)
                              }}
                              onDragEnd={handleDragEnd}
                            >
                              ⋮⋮
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
    </div>
  )
}
