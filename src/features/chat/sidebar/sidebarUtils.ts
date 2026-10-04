import i18n from '../../../i18n'

/** 格式化通知时间戳为相对时间 */
export function formatNotificationTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return i18n.t('common:relativeTime.justNow')
  if (diff < 3600_000) return i18n.t('common:relativeTime.minutesAgo', { count: Math.floor(diff / 60_000) })
  return i18n.t('common:relativeTime.hoursAgo', { count: Math.floor(diff / 3600_000) })
}
