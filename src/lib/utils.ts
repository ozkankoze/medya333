import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** "0-1 saat", "6 saat", "2 gün" — SLA vaadini insan diline çevirir. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null) return null
  if (minutes <= 0) return 'Anında'
  if (minutes < 60) return `${minutes} dakika`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} saat`
  const days = Math.round(hours / 24)
  return `${days} gün`
}

export function formatDateTimeTR(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`
}
