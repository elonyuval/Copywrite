const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' })
const dtf = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' })

export function timeAgo(date: string | Date): string {
  const d = new Date(date).getTime()
  const diff = (d - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'עכשיו'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day')
  return dtf.format(new Date(date))
}

export const fullDate = (date: string | Date) => dtf.format(new Date(date))

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
