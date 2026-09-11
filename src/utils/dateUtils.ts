import i18n from '../i18n'
import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from '../constants'

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return ''

  const now = Date.now()
  const diff = now - timestamp

  const minutes = Math.floor(diff / MS_PER_MINUTE)
  const hours = Math.floor(diff / MS_PER_HOUR)
  const days = Math.floor(diff / MS_PER_DAY)

  if (minutes < 1) return i18n.t('common:relativeTime.justNow')
  if (minutes < 60) return i18n.t('common:relativeTime.minutesAgo', { count: minutes })
  if (hours < 24) return i18n.t('common:relativeTime.hoursAgo', { count: hours })
  if (days < 7) return i18n.t('common:relativeTime.daysAgo', { count: days })

  return new Date(timestamp).toLocaleDateString(i18n.language)
}
