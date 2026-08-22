import { twMerge } from 'tailwind-merge'

export function cn(...values: Array<false | null | string | undefined>) {
  return twMerge(values.filter(Boolean).join(' '))
}
