import type { SVGProps } from 'react'

import type { AiToolKind } from './model'

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function ChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  )
}

export function XMark(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  )
}

export function ToolIcon({ kind, ...props }: { kind: AiToolKind } & SVGProps<SVGSVGElement>) {
  if (kind === 'command') {
    return (
      <Svg {...props}>
        <path d="m4 17 6-6-6-6M12 19h8" />
      </Svg>
    )
  }
  if (kind === 'search') {
    return (
      <Svg {...props}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </Svg>
    )
  }
  if (kind === 'web') {
    return (
      <Svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </Svg>
    )
  }
  if (kind === 'read') {
    return (
      <Svg {...props}>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </Svg>
    )
  }
  if (kind === 'edit') {
    return (
      <Svg {...props}>
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </Svg>
    )
  }
  if (kind === 'list') {
    return (
      <Svg {...props}>
        <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
      </Svg>
    )
  }
  if (kind === 'mail') {
    return (
      <Svg {...props}>
        <rect height="14" rx="2" width="20" x="2" y="5" />
        <path d="m3 7 9 6 9-6" />
      </Svg>
    )
  }
  if (kind === 'message') {
    return (
      <Svg {...props}>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      </Svg>
    )
  }
  if (kind === 'image' || kind === 'video') {
    return (
      <Svg {...props}>
        <rect height="18" rx="2" width="18" x="3" y="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </Svg>
    )
  }
  if (kind === 'handoff') {
    return (
      <Svg {...props}>
        <path d="M6 3v12M18 9v12M6 15c0-3 3-6 6-6h6M14 5l4 4-4 4" />
      </Svg>
    )
  }
  if (kind === 'connected-app') {
    return (
      <Svg {...props}>
        <path d="m12 22 1-5-4-2 6-13-1 8 5 2Z" />
      </Svg>
    )
  }
  return (
    <Svg {...props}>
      <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3Z" />
    </Svg>
  )
}
