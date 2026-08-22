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

/** Group draft rows into sections: a user row starts a section and assistant
 * rows attach to the section started by the nearest previous user row. */
function buildSections(
  rows: readonly DraftRow[],
  baseline: ReadonlyMap<string, EditableMessageBlock>,
  retryableTurns: readonly RetryableTurn[],
): DraftSection[] {
  const retryable = new Map(retryableTurns.map(turn => [turn.turn, turn]))
  const sections: DraftSection[] = []
  let addedCount = 0
  for (const row of rows) {
    if (row.kind !== 'user' && sections.length > 0) {
      const last = sections[sections.length - 1]
      if (last !== undefined) last.rows.push(row)
      continue
    }
    const isAddedUser = row.kind === 'user' && row.added
    const section: DraftSection = {
      id: isAddedUser
        ? `added-${String(addedCount += 1)}`
        : row.turn === undefined
          ? `row-${row.key}`
          : `turn-${String(row.turn)}`,
      turnLabel: row.kind === 'user'
        ? row.added ? '新增回合' : `回合 ${String(row.turn ?? '?')}`
        : row.turn === undefined ? '无用户回合' : `回合 ${String(row.turn)}`,
      preview: row.text,
      rows: [row],
    }
    sections.push(section)
  }
  for (const section of sections) {
    const head = section.rows[0]
    if (head === undefined) continue
    const userRow = section.rows.find(row => row.kind === 'user')
    section.preview = (userRow ?? head).text
    const unchanged = section.rows.every(
      row => !row.added && baseline.get(row.key)?.text === row.text,
    )
    if (head.kind === 'user' && !head.added && head.turn !== undefined && unchanged) {
      const retry = retryable.get(head.turn)
      if (retry !== undefined) section.retry = retry
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
  disabled,
  onBeginEdit,
  onCancelEdit,
  onTextChange,
  onApplyEdit,
  onDelete,
}: {
  row: DraftRow
  baseline: EditableMessageBlock | undefined
  editing: EditingState | null
  disabled: boolean
  onBeginEdit: (row: DraftRow) => void
  onCancelEdit: () => void
  onTextChange: (text: string) => void
  onApplyEdit: (row: DraftRow, text: string) => void
  onDelete: (row: DraftRow) => void
}): ReactNode {
  const active = editing?.key === row.key
  const edited = !row.added && baseline !== undefined && baseline.text !== row.text
  return (
    <article className={styles['messageCard']} data-added={row.added || undefined}>
      <div className={styles['messageHeader']}>
        <span className={styles['kindBadge']} data-kind={row.kind}>{BLOCK_LABEL[row.kind]}</span>
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
        : <pre className={styles['messageText']}>{row.text || '（空内容）'}</pre>}
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
  }, [signature, baselineRows])

  const rows = draft?.rows ?? baselineRows
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
    setDraft({
      signature,
      rows: current.text.length === 0
        ? rows.filter(candidate => candidate.key !== current.key)
        : rows.map(candidate => candidate.key === current.key
          ? { ...candidate, text: current.text }
          : candidate),
    })
  }

  const beginEdit = (row: DraftRow): void => {
    const current = editing
    setEditing({ key: row.key, text: row.text })
    if (current === null) return
    settleAddedRow(current, rows.find(candidate => candidate.key === current.key))
  }

  const cancelEdit = (): void => {
    const current = editing
    setEditing(null)
    if (current === null) return
    const row = rows.find(candidate => candidate.key === current.key)
    if (row?.added === true) {
      setDraft({ signature, rows: rows.filter(candidate => candidate.key !== current.key) })
    }
  }

  const applyEdit = (row: DraftRow, text: string): void => {
    setEditing(null)
    setDraft({
      signature,
      rows: rows.map(candidate => candidate.key === row.key ? { ...candidate, text } : candidate),
    })
  }

  const deleteRow = (row: DraftRow): void => {
    if (editing?.key === row.key) setEditing(null)
    if (row.kind !== 'user') {
      setDraft({ signature, rows: rows.filter(candidate => candidate.key !== row.key) })
      return
    }
    const section = sections.find(
      candidate => candidate.rows.some(candidateRow => candidateRow.key === row.key),
    )
    const doomed = new Set(section?.rows.map(candidateRow => candidateRow.key) ?? [row.key])
    setDraft({ signature, rows: rows.filter(candidate => !doomed.has(candidate.key)) })
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
    setDraft({ signature, rows: next })
    setEditing({ key: row.key, text: '' })
  }

  const resetDraft = (): void => {
    setEditing(null)
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
            {changes.hasChanges
              ? (
                <span className={styles['changeSummary']}>
                  <span className={styles['changeChip']}>{changeSummaryText(changes)}</span>
                  <button
                    type="button"
                    className={styles['textButton']}
                    disabled={busy}
                    onClick={resetDraft}
                  >
                    重置
                  </button>
                </span>
              )
              : <span className={styles['count']}>{String(timeline.messages.length)}</span>}
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
                    return (
                    <li key={section.id} className={styles['turnSection']}>
                      <div className={styles['turnHeader']}>
                        <div>
                          <h3 className={styles['turnTitle']}>{section.turnLabel}</h3>
                          <p className={styles['turnPreview']}>{section.preview || '（空内容）'}</p>
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
                      <div className={styles['messageList']}>
                        {section.rows.map(row => (
                          <MessageCard
                            key={row.key}
                            row={row}
                            baseline={baseline.get(row.key)}
                            editing={editing}
                            disabled={busy}
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
