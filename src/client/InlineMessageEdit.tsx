/**
 * Message-row edit affordance: injects retry + edit icon buttons into each
 * settled message's icon-actions row (the official MessageIconActions has no
 * plugin slot, so injection rides a MutationObserver over action rows).
 * Icons are the official outline-16 SVGs inlined to avoid bundling the
 * primitives package.
 */
import { useEffect, useRef } from 'react'
import { retryTurnForEvent, type EditableMessageBlock } from '../shared.ts'
import type { MessageEditFace } from './controller.ts'
import styles from './InlineMessageEdit.module.css'

const BLOCK_TITLE: Record<EditableMessageBlock['kind'], string> = {
  user: '编辑用户消息',
  'assistant.reasoning': '编辑助手思考',
  'assistant.response': '编辑助手回复',
  system: '编辑 System Prompt',
  'tool.call': '编辑工具调用',
  'tool.result': '编辑工具返回',
  'context.inject': '编辑注入上下文',
}

const STYLE = {
  overlay: styles['overlay'] ?? '',
  panel: styles['panel'] ?? '',
  title: styles['title'] ?? '',
  input: styles['input'] ?? '',
  footer: styles['footer'] ?? '',
  iconButton: styles['iconButton'] ?? '',
  picker: styles['picker'] ?? '',
  pickerItem: styles['pickerItem'] ?? '',
  pickerItemActive: styles['pickerItemActive'] ?? '',
}

/** Official ic_ds_refresh_outline_16 path (dsh-client-ui-primitives). */
const REFRESH_PATH = 'M7.92136 0.349152C10.3744 0.349234 12.5564 1.5052 13.9557 3.29894L15.1281 2.12759C15.3303 1.92546 15.6767 2.06943 15.6767 2.35538V5.53923C15.6766 5.71626 15.5329 5.85976 15.3559 5.86002H12.171C11.8854 5.8597 11.7426 5.51465 11.9443 5.31249L12.9641 4.29056C11.8237 2.74305 9.98908 1.74106 7.92136 1.74097C4.46436 1.74097 1.66233 4.543 1.66233 8C1.66233 11.457 4.46436 14.259 7.92136 14.259C11.3782 14.2589 14.1804 11.4569 14.1804 8H15.5722C15.5722 12.2251 12.1465 15.6507 7.92136 15.6508C3.69614 15.6508 0.270508 12.2252 0.270508 8C0.270508 3.77478 3.69614 0.349152 7.92136 0.349152Z'

/** Official ic_ds_edit_outline_16 path (dsh-client-ui-primitives). */
const EDIT_PATH = 'M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z'

function svgIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', path)
  p.setAttribute('fill', 'currentColor')
  svg.appendChild(p)
  return svg
}

function blockTitle(kind: EditableMessageBlock['kind']): string {
  return BLOCK_TITLE[kind] ?? '编辑消息'
}

type OverlayCleanup = () => void

/** Mount one editor DOM effect and return its exact inverse. */
function mountEditor(
  block: EditableMessageBlock,
  edit: MessageEditFace['edit'],
  close: () => void,
): OverlayCleanup {
  const overlay = document.createElement('div')
  overlay.className = STYLE.overlay
  const panel = document.createElement('div')
  panel.className = STYLE.panel
  const title = document.createElement('div')
  title.className = STYLE.title
  title.textContent = blockTitle(block.kind)
  const input = document.createElement('textarea')
  input.className = STYLE.input
  input.value = block.text
  const footer = document.createElement('div')
  footer.className = STYLE.footer
  const save = document.createElement('button')
  save.textContent = '保存'
  const cancel = document.createElement('button')
  cancel.textContent = '取消'
  footer.append(save, cancel)
  panel.append(title, input, footer)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  let mounted = true
  let saving = false
  const saveEdit = (): void => {
    if (saving) return
    saving = true
    save.disabled = true
    void edit(block, input.value, 'truncate').then((applied) => {
      if (!mounted) return
      if (applied) {
        close()
        return
      }
      saving = false
      save.disabled = false
    })
  }
  const cancelEdit = (): void => { close() }
  const dismiss = (event: MouseEvent): void => { if (event.target === overlay) close() }
  save.addEventListener('click', saveEdit)
  cancel.addEventListener('click', cancelEdit)
  overlay.addEventListener('click', dismiss)
  return () => {
    mounted = false
    save.removeEventListener('click', saveEdit)
    cancel.removeEventListener('click', cancelEdit)
    overlay.removeEventListener('click', dismiss)
    overlay.remove()
  }
}

/** Mount one block-picker DOM effect and return its exact inverse. */
function mountPicker(
  blocks: readonly EditableMessageBlock[],
  select: (block: EditableMessageBlock) => void,
  close: () => void,
): OverlayCleanup {
  const overlay = document.createElement('div')
  overlay.className = STYLE.overlay
  const panel = document.createElement('div')
  panel.className = STYLE.panel
  const title = document.createElement('div')
  title.className = STYLE.title
  title.textContent = blocks.some(block => block.kind === 'user') ? '编辑消息' : '编辑助手消息'
  const picker = document.createElement('div')
  picker.className = STYLE.picker
  const itemListeners: Array<{ item: HTMLButtonElement; listener: () => void }> = []
  for (const block of blocks) {
    const item = document.createElement('button')
    item.className = STYLE.pickerItem
    item.textContent = `${blockTitle(block.kind)}：${block.text.slice(0, 24)}${block.text.length > 24 ? '…' : ''}`
    const listener = (): void => { select(block) }
    item.addEventListener('click', listener)
    itemListeners.push({ item, listener })
    picker.appendChild(item)
  }
  const cancel = document.createElement('button')
  cancel.textContent = '取消'
  cancel.className = STYLE.pickerItemActive
  const cancelPicker = (): void => { close() }
  cancel.addEventListener('click', cancelPicker)
  panel.append(title, picker, cancel)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  return () => {
    for (const { item, listener } of itemListeners) item.removeEventListener('click', listener)
    cancel.removeEventListener('click', cancelPicker)
    overlay.remove()
  }
}

/** Compose every overlay with a single idempotent active inverse. */
function createOverlayHost(edit: MessageEditFace['edit']): {
  editBlock(block: EditableMessageBlock): void
  chooseBlock(blocks: readonly EditableMessageBlock[]): void
  dispose(): void
} {
  let active: OverlayCleanup | undefined
  const mount = (effect: (close: () => void) => OverlayCleanup): void => {
    active?.()
    let cleanup: OverlayCleanup = () => {}
    let mounted = true
    const close = (): void => {
      if (!mounted) return
      mounted = false
      cleanup()
      if (active === close) active = undefined
    }
    active = close
    try {
      cleanup = effect(close)
    } catch (error: unknown) {
      active = undefined
      mounted = false
      throw error
    }
  }
  const editBlock = (block: EditableMessageBlock): void => {
    mount(close => mountEditor(block, edit, close))
  }
  const chooseBlock = (blocks: readonly EditableMessageBlock[]): void => {
    mount(close => mountPicker(blocks, (block) => {
      close()
      editBlock(block)
    }, close))
  }
  return {
    editBlock,
    chooseBlock,
    dispose: () => { active?.() },
  }
}

/** Inject retry + edit icon buttons into each user message action row. */
export function InlineMessageEdit({
  messages,
  edit,
  retry,
}: {
  messages: readonly EditableMessageBlock[]
  edit: MessageEditFace['edit']
  retry: MessageEditFace['retry']
}): null {
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const editRef = useRef(edit)
  editRef.current = edit
  const retryRef = useRef(retry)
  retryRef.current = retry
  const syncRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const cleanups: Array<() => void> = []
    const overlays = createOverlayHost((block, text, cascade) => editRef.current(block, text, cascade))
    let observer: MutationObserver | undefined
    let alive = true
    let frame: number | undefined
    let scheduled = false

    const sync = (): void => {
      const currentMessages = messagesRef.current
      if (currentMessages.length === 0) return

      // Clean up any stray/orphan injected buttons that are NOT inside a userRow (e.g. AI responses)
      const strayButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-message-edit-injected]'))
      for (const btn of strayButtons) {
        if (!btn.closest('[class*="userRow"]')) {
          btn.remove()
        }
      }

      // ONLY target user messages: find userRow elements that are not context/injected rows
      const userRows = Array.from(document.querySelectorAll<HTMLElement>(
        '[class*="userRow"]:not([class*="contextRow"])',
      )).filter(row => !row.hasAttribute('data-pending-steering') && !row.hasAttribute('data-submission-echo'))

      const userMessages = currentMessages.filter(m => m.kind === 'user')
      if (userMessages.length === 0) return

      const claimedEvents = new Set<number>()

      for (const userRow of userRows) {
        const actionRow = userRow.querySelector<HTMLElement>('[class*="actions"]')
        if (!actionRow) continue

        const marker = actionRow as HTMLElement & {
          __messageEditInjected?: boolean
          __messageEditEventSeq?: number
          __messageEditTurn?: number
          __messageEditCleanup?: () => void
        }

        // Extract turn from DOM ancestor if present
        const turnContainer = userRow.closest<HTMLElement>('[data-chat-turn]')
        const turnAttr = turnContainer?.getAttribute('data-chat-turn')
        const domTurn = turnAttr ? Number.parseInt(turnAttr, 10) : undefined
        const hasValidDomTurn = domTurn !== undefined && Number.isFinite(domTurn)

        if (marker.__messageEditInjected === true) {
          const stillValid = marker.__messageEditEventSeq !== undefined &&
            userMessages.some(message => message.eventSeq === marker.__messageEditEventSeq) &&
            (!hasValidDomTurn || marker.__messageEditTurn === domTurn)
          if (stillValid && actionRow.querySelector('[data-message-edit-injected]')) {
            if (marker.__messageEditEventSeq !== undefined) claimedEvents.add(marker.__messageEditEventSeq)
            continue
          }
          marker.__messageEditCleanup?.()
          marker.__messageEditInjected = false
        }

        const bubble = userRow.querySelector<HTMLElement>('[class*="bubble"]')
        const userText = (bubble?.textContent ?? userRow.textContent ?? '').trim()

        let candidate: EditableMessageBlock | undefined

        // 1. 优先利用 DOM 原生的 data-chat-turn 进行严格回合限域
        if (hasValidDomTurn) {
          const turnCandidates = userMessages.filter(
            m => !claimedEvents.has(m.eventSeq) && m.turn === domTurn,
          )
          candidate = turnCandidates.find(m => userText.includes(m.text) || m.text.includes(userText))
            ?? turnCandidates[0]
        } else {
          // 2. 降级：仅在缺失 data-chat-turn 时，按未认领的顺序匹配
          const unclaimed = userMessages.filter(m => !claimedEvents.has(m.eventSeq))
          candidate = unclaimed.find(m => m.text.length > 0 && userText.includes(m.text))
            ?? unclaimed[0]
        }

        if (!candidate) continue

        const eventSeq = candidate.eventSeq
        const turn = candidate.turn
        claimedEvents.add(eventSeq)
        marker.__messageEditInjected = true
        marker.__messageEditEventSeq = eventSeq
        marker.__messageEditTurn = turn

        const editButton = document.createElement('button')
        editButton.type = 'button'
        editButton.className = STYLE.iconButton
        editButton.setAttribute('aria-label', '编辑消息')
        editButton.setAttribute('data-message-edit-injected', 'true')
        editButton.setAttribute('data-message-edit-turn', String(turn))
        editButton.title = '编辑消息'
        editButton.appendChild(svgIcon(EDIT_PATH))
        const editMessage = (e: MouseEvent): void => {
          e.preventDefault()
          e.stopPropagation()

          const currentTurnAttr = editButton.closest<HTMLElement>('[data-chat-turn]')?.getAttribute('data-chat-turn')
            ?? editButton.getAttribute('data-message-edit-turn')
          const realDomTurn = currentTurnAttr ? Number.parseInt(currentTurnAttr, 10) : undefined

          let targetBlock = messagesRef.current.find(m => m.eventSeq === eventSeq && m.kind === 'user')
          if (!targetBlock && realDomTurn !== undefined && Number.isFinite(realDomTurn)) {
            targetBlock = messagesRef.current.find(m => m.turn === realDomTurn && m.kind === 'user')
          }
          targetBlock = targetBlock ?? candidate
          if (targetBlock) overlays.editBlock(targetBlock)
        }
        editButton.addEventListener('click', editMessage)

        const retryButton = document.createElement('button')
        retryButton.type = 'button'
        retryButton.className = STYLE.iconButton
        retryButton.setAttribute('aria-label', '重试此回合')
        retryButton.setAttribute('data-message-edit-injected', 'true')
        retryButton.setAttribute('data-message-edit-turn', String(turn))
        retryButton.title = '重试此回合'
        retryButton.appendChild(svgIcon(REFRESH_PATH))
        const retryTurn = (e: MouseEvent): void => {
          e.preventDefault()
          e.stopPropagation()
          if (retryButton.disabled) return

          // The exact event bound during injection is the retry contract. DOM
          // `data-chat-turn` only describes a rendered/virtualized seat and can
          // be stale, re-numbered, or nested after an upstream UI upgrade; it
          // must never override the timeline's eventSeq -> turn mapping.
          const targetTurn = retryTurnForEvent(messagesRef.current, eventSeq)
          if (targetTurn === undefined) {
            console.warn('[dsh-message-edit] 重试目标已过期，正在重新同步消息操作。')
            syncRef.current?.()
            return
          }

          retryButton.disabled = true
          retryButton.style.opacity = '0.5'
          retryButton.title = '正在重试…'

          void retryRef.current(targetTurn, 'truncate').then((success) => {
            if (!success) {
              retryButton.disabled = false
              retryButton.style.opacity = ''
              retryButton.title = '重试此回合'
            }
          }).catch((err) => {
            console.error('[dsh-message-edit] 重试失败:', err)
            retryButton.disabled = false
            retryButton.style.opacity = ''
            retryButton.title = '重试此回合'
          })
        }
        retryButton.addEventListener('click', retryTurn)

        // Insert after the last official action button so injected icons
        // stay contiguous with copy/branch and the clock keeps its side.
        const officialButtons = Array.from(actionRow.querySelectorAll('button'))
          .filter(button => !button.hasAttribute('data-message-edit-injected'))
        const lastOfficial = officialButtons.at(-1)
        if (lastOfficial !== undefined) {
          lastOfficial.insertAdjacentElement('afterend', retryButton)
          lastOfficial.insertAdjacentElement('afterend', editButton)
        } else {
          actionRow.appendChild(editButton)
          actionRow.appendChild(retryButton)
        }

        const rowCleanup = (): void => {
          editButton.removeEventListener('click', editMessage)
          retryButton.removeEventListener('click', retryTurn)
          editButton.remove()
          retryButton.remove()
          delete marker.__messageEditInjected
          delete marker.__messageEditEventSeq
          delete marker.__messageEditTurn
          delete marker.__messageEditCleanup
        }
        marker.__messageEditCleanup = rowCleanup
        cleanups.push(rowCleanup)
      }
    }

    syncRef.current = sync
    sync()
    observer = new MutationObserver(() => {
      if (!alive || scheduled) return
      scheduled = true
      frame = requestAnimationFrame(() => {
        frame = undefined
        scheduled = false
        if (alive) sync()
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      alive = false
      syncRef.current = null
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer?.disconnect()
      overlays.dispose()
      for (const cleanup of cleanups.reverse()) cleanup()
    }
  }, [])

  useEffect(() => {
    syncRef.current?.()
  }, [messages])

  return null
}
