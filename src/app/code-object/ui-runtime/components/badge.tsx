import type { ReactNode } from 'react'

import { cn } from '../classnames'
import type { CodeObjectUiTone } from '../types'

const TONE_CLASSES: Record<CodeObjectUiTone, string> = {
  accent: 'border-accent/30 bg-accent/12 text-accent',
  danger: 'border-red-500/30 bg-red-500/12 text-red-600 [[data-theme=dark]_&]:text-red-300',
  neutral: 'border-border bg-secondary text-secondary-foreground',
  success:
    'border-emerald-500/30 bg-emerald-500/12 text-emerald-700 [[data-theme=dark]_&]:text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/12 text-amber-700 [[data-theme=dark]_&]:text-amber-300'
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: CodeObjectUiTone
}) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none',
        TONE_CLASSES[tone]
      )}
    >
      {children}
    </span>
  )
}
