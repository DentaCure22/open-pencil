import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '../classnames'

export function Card({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.05)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="flex items-start justify-between gap-3 px-4 pt-4">{children}</div>
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="m-0 text-sm font-semibold tracking-[-0.01em]">{children}</h2>
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 pb-4 pt-3', className)}>{children}</div>
}
