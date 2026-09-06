import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageEditFace } from './controller.ts'
import { InlineMessageEdit } from './InlineMessageEdit.tsx'

type MessageEditHeaderProps = PropsRuntime<'conversation.session.header.actions'> & InjectFace<MessageEditFace>

/**
 * Header contribution registered into conversation.session.header.actions.
 * The top header effect navigation and reroll button are hidden;
 * this component mounts InlineMessageEdit to support message-level editing.
 */
export function MessageEditHeader({
  useMessageEdit,
  acquire,
  load,
  edit,
  retry,
}: MessageEditHeaderProps): ReactNode {
  const state = useMessageEdit(value => value)

  useEffect(() => {
    const release = acquire()
    load()
    return release
  }, [acquire, load])

  const timeline = state.timeline

  return (
    <InlineMessageEdit
      key={timeline?.sessionId ?? 'none'}
      messages={timeline?.messages ?? []}
      edit={edit}
      retry={retry}
    />
  )
}
