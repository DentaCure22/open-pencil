/*
 * React island adapted from T3 Code's ComposerBannerStack at
 * 5d7665396083d285132d67038813862a93337ca5 (MIT, T3 Tools Inc.).
 * See THIRD_PARTY_NOTICES.md.
 */
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'

export type T3ComposerBannerItem = {
  action?: 'retry'
  actionLabel?: string
  description?: string
  dismissible?: boolean
  id: string
  title: string
  variant: 'error' | 'info' | 'success' | 'warning'
}

const DISMISS_MS = 220

function BannerIcon({ variant }: { variant: T3ComposerBannerItem['variant'] }) {
  if (variant === 'success') return <CircleCheckIcon aria-hidden="true" />
  if (variant === 'info') return <InfoIcon aria-hidden="true" />
  return <TriangleAlertIcon aria-hidden="true" />
}

const Banner = memo(function Banner(props: {
  attached: boolean
  exiting: boolean
  item: T3ComposerBannerItem
  onAction: (id: string) => void
  onDismiss: (id: string) => void
}) {
  return (
    <div
      className="t3-composer-banner"
      data-attached={props.attached ? 'true' : 'false'}
      data-exiting={props.exiting ? 'true' : 'false'}
      data-variant={props.item.variant}
      role={props.item.variant === 'error' ? 'alert' : 'status'}
    >
      <span className="t3-composer-banner-icon">
        <BannerIcon variant={props.item.variant} />
      </span>
      <span className="t3-composer-banner-copy">
        <strong>{props.item.title}</strong>
        {props.item.description ? <span>{props.item.description}</span> : null}
      </span>
      {props.item.action ? (
        <button
          className="t3-composer-banner-action"
          onClick={() => props.onAction(props.item.id)}
          type="button"
        >
          {props.item.actionLabel ?? 'Retry'}
        </button>
      ) : null}
      {props.item.dismissible ? (
        <button
          aria-label={`Dismiss ${props.item.title}`}
          className="t3-composer-banner-dismiss"
          disabled={props.exiting}
          onClick={() => props.onDismiss(props.item.id)}
          type="button"
        >
          <XIcon aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
})

export default memo(function T3ComposerBannerStack(props: {
  items: T3ComposerBannerItem[]
  onAction: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const [requestedExit, setRequestedExit] = useState<string | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exiting =
    requestedExit && props.items.some((item) => item.id === requestedExit) ? requestedExit : null

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current)
    },
    []
  )

  const front = props.items[0]
  const stacked = props.items.slice(1)

  const dismiss = (id: string) => {
    if (exiting) return
    setRequestedExit(id)
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = setTimeout(() => {
      timeout.current = null
      props.onDismiss(id)
    }, DISMISS_MS)
  }

  return (
    <div className="t3-composer-banner-stack" data-test-id="ai-composer-banner-stack">
      {stacked.length && exiting !== front.id ? (
        <span
          aria-hidden="true"
          className="t3-composer-banner-cap"
          data-variant={stacked[0]?.variant}
        />
      ) : null}
      <div className="t3-composer-banner-front">
        <Banner
          attached
          exiting={exiting === front.id}
          item={front}
          onAction={props.onAction}
          onDismiss={dismiss}
        />
      </div>
      {stacked.length ? (
        <div className="t3-composer-banner-expanded">
          <div>
            {stacked.map((item) => (
              <Banner
                attached={false}
                exiting={exiting === item.id}
                item={item}
                key={item.id}
                onAction={props.onAction}
                onDismiss={dismiss}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
})
