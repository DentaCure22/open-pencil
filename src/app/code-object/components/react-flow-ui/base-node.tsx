import type { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'

export function BaseNode({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={twMerge(
        'bg-card text-card-foreground relative rounded-md border',
        'hover:ring-1',
        'in-[.selected]:border-muted-foreground',
        'in-[.selected]:shadow-lg',
        className
      )}
      tabIndex={0}
      {...props}
    />
  )
}

export function BaseNodeHeader({ className, ...props }: ComponentProps<'header'>) {
  return (
    <header
      {...props}
      className={twMerge(
        'mx-0 my-0 -mb-1 flex flex-row items-center justify-between gap-2 px-3 py-2',
        className
      )}
    />
  )
}

export function BaseNodeContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="base-node-content"
      className={twMerge('flex flex-col gap-y-2 p-3', className)}
      {...props}
    />
  )
}
