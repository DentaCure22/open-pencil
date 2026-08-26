/*
 * React island adapted from T3 Code's ComposerCommandMenu at
 * 5d7665396083d285132d67038813862a93337ca5 (MIT, T3 Tools Inc.).
 * See THIRD_PARTY_NOTICES.md.
 */
import { ChevronRightIcon, FileIcon, SparklesIcon } from 'lucide-react'
import { memo, useLayoutEffect, useRef } from 'react'

import type { T3ComposerCommandItem, T3ComposerTriggerKind } from './t3-chat-chrome.logic'

function ItemIcon({ kind }: { kind: T3ComposerCommandItem['kind'] }) {
  if (kind === 'path') return <FileIcon aria-hidden="true" />
  if (kind === 'skill') return <SparklesIcon aria-hidden="true" />
  return <ChevronRightIcon aria-hidden="true" />
}

export default memo(function T3ComposerCommandMenu(props: {
  activeItemId: string | null
  emptyStateText?: string
  isLoading: boolean
  items: T3ComposerCommandItem[]
  onHighlight: (id: string) => void
  onSelect: (id: string) => void
  triggerKind: T3ComposerTriggerKind
}) {
  const listRef = useRef<HTMLDivElement>(null)
  let emptyStateText = props.emptyStateText ?? 'No matching command.'
  if (props.isLoading) {
    emptyStateText =
      props.triggerKind === 'path' ? 'Searching workspace files…' : 'Searching skills…'
  }

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return
    const element = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`
    )
    element?.scrollIntoView({ block: 'nearest' })
  }, [props.activeItemId])

  return (
    <div
      className="t3-composer-command-menu"
      data-composer-command-drawer="true"
      data-test-id="ai-composer-command-menu"
      ref={listRef}
      role="listbox"
    >
      {props.items.length ? (
        <div className="t3-composer-command-list">
          {props.items.map((item) => {
            const active = props.activeItemId === item.id
            return (
              <button
                aria-selected={active}
                className="t3-composer-command-item"
                data-active={active ? 'true' : 'false'}
                data-composer-item-id={item.id}
                key={item.id}
                onClick={() => props.onSelect(item.id)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => props.onHighlight(item.id)}
                role="option"
                type="button"
              >
                <span className="t3-composer-command-icon">
                  <ItemIcon kind={item.kind} />
                </span>
                <span className="t3-composer-command-label">{item.label}</span>
                <span className="t3-composer-command-description">{item.description}</span>
                {item.kind === 'skill' ? (
                  <span className="t3-composer-command-badge">Project skill</span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="t3-composer-command-empty">{emptyStateText}</p>
      )}
    </div>
  )
})
