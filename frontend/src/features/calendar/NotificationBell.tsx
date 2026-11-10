import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { AppNotification } from '../../api/types'
import { Icon } from '../../components/Icon'
import { Menu, type MenuItem } from '../../components/Menu'
import { formatDayShort } from '../../lib/format'
import { today } from '../../lib/calendar'
import { daysUntil } from './calendarLogic'
import { useMarkRead, useNotifications } from './hooks'

/** How many reminders the bell lists; the calendar has the rest. */
const SHOWN = 8

/**
 * The bell in the top bar: how many reminders are unread, and the newest ones. Choosing one marks it read
 * and opens its day on the calendar.
 */
export function NotificationBell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const notifications = useNotifications(true)
  const markRead = useMarkRead()
  const unread = notifications.data?.unread ?? 0
  const list = notifications.data?.items ?? []
  const now = today()

  // When, counted from today rather than from when the reminder was made, so it never goes stale.
  function when(n: AppNotification) {
    const days = daysUntil(n.day, now)
    const date = formatDayShort(n.day, i18n.language)
    if (days === 0) return t('notifications.today', { date })
    if (days === 1) return t('notifications.tomorrow', { date })
    if (days > 1) return t('notifications.inDays', { count: days, date })
    return t('notifications.past', { date })
  }

  const items: MenuItem[] = list.slice(0, SHOWN).map((n) => {
    const where =
      n.projectName ??
      (n.sharedBy ? t('calendar.sharedBy', { name: n.sharedBy }) : t('calendar.personal'))
    return {
      key: n.id,
      label: `${n.title} · ${when(n)}`,
      ariaLabel: [n.readAt ? null : t('notifications.unreadMark'), n.title, when(n), where]
        .filter(Boolean)
        .join(', '),
      leading: (
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-primary'}`}
        />
      ),
      onSelect: () => {
        if (!n.readAt) markRead.mutate([n.id])
        void navigate(`/calendar?day=${n.day}`)
      },
    }
  })
  if (unread > 0)
    items.push({
      key: 'read-all',
      icon: 'check',
      label: t('notifications.readAll'),
      separated: list.length > 0,
      onSelect: () => markRead.mutate(undefined),
    })
  items.push({
    key: 'open-calendar',
    icon: 'calendar',
    label: t('notifications.openCalendar'),
    onSelect: () => void navigate('/calendar'),
  })

  return (
    <Menu
      label={
        unread > 0 ? t('notifications.labelUnread', { count: unread }) : t('notifications.label')
      }
      triggerClassName="relative grid h-11 w-11 place-items-center rounded-xl text-text hover:bg-primary-bg aria-expanded:bg-primary-bg sm:h-9 sm:w-9"
      trigger={
        <>
          <Icon name="bell" size={20} />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-on-primary"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </>
      }
      header={
        <p className="font-semibold">
          {list.length === 0 ? t('notifications.empty') : t('notifications.title')}
        </p>
      }
      items={items}
    />
  )
}
