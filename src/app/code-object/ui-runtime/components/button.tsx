import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '../classnames'

export function Button({
  children,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={cn(
        'inline-flex min-h-8 items-center justify-center rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground transition-colors',
        'enabled:hover:border-accent/40 enabled:hover:bg-accent/10 enabled:hover:text-card-foreground disabled:cursor-default disabled:opacity-45',
        className
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
}
