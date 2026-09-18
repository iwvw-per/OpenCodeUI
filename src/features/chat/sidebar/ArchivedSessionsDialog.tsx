import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Button } from '../../../components/ui'
import { ArchiveIcon, TrashIcon, UndoIcon } from '../../../components/Icons'
import { useArchivedSessions } from '../../../hooks'
import { splitSessionKey } from '../../../utils/sessionKey'
import { cn } from '../../../utils/cn'

interface ArchivedSessionsDialogProps {
  isOpen: boolean
  onClose: () => void
  serverId?: string
  /** 恢复后跳转/刷新用（当前不需要，保留以便调用方联动） */
  activeSessionKey?: string | null
}

function formatArchivedAt(timestamp: number | undefined): string {
  if (!timestamp) return '—'
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export function ArchivedSessionsDialog({ isOpen, onClose, serverId }: ArchivedSessionsDialogProps) {
  const { t } = useTranslation(['chat', 'common', 'commands'])
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('chat:archived.title', { defaultValue: 'Archived chats' })}
      width={560}
      className="w-full"
    >
      {isOpen ? <ArchivedSessionsBody serverId={serverId} /> : null}
    </Dialog>
  )
}

function ArchivedSessionsBody({ serverId }: { serverId?: string }) {
  const { t } = useTranslation(['chat', 'common', 'commands'])
  const { sessions, isLoading, error, restore, remove } = useArchivedSessions({ enabled: true, serverId })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (b.time?.archived ?? 0) - (a.time?.archived ?? 0)),
    [sessions],
  )

  const handleRestore = async (sessionId: string) => {
    setBusyId(sessionId)
    try {
      await restore(sessionId)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (sessionId: string) => {
    setBusyId(sessionId)
    try {
      await remove(sessionId)
      setConfirmId(null)
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading && sorted.length === 0) {
    return (
      <div className="py-10 text-center text-[length:var(--fs-sm)] text-text-400">{t('common:loading')}</div>
    )
  }

  if (error && sorted.length === 0) {
    return (
      <div className="py-10 text-center text-[length:var(--fs-sm)] text-text-400">
        {t('chat:archived.loadFailed', { defaultValue: 'Failed to load archived chats' })}
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="py-10 flex flex-col items-center gap-2 text-text-400">
        <ArchiveIcon size={24} className="opacity-50" />
        <span className="text-[length:var(--fs-sm)]">
          {t('chat:archived.empty', { defaultValue: 'No archived chats' })}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
      {sorted.map(session => {
        const rawId = splitSessionKey(session.id).sessionId
        const isBusy = busyId === session.id
        const isConfirming = confirmId === session.id
        return (
          <div
            key={session.id}
            className={cn(
              'group flex items-center gap-3 rounded-lg border border-border-200/50 bg-bg-100 px-3 py-2',
              'transition-colors',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[length:var(--fs-sm)] text-text-200">
                {session.title || t('commands:sessions.untitledChat', { defaultValue: 'Untitled' })}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[length:var(--fs-xxs)] text-text-500">
                <span className="tabular-nums">{formatArchivedAt(session.time?.archived)}</span>
                {session.directory && (
                  <>
                    <span className="opacity-30">·</span>
                    <span className="truncate font-mono" title={session.directory}>
                      {session.directory}
                    </span>
                  </>
                )}
              </div>
            </div>

            {isConfirming ? (
              <div className="shrink-0 flex items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={isBusy}
                  onClick={() => void handleDelete(session.id)}
                >
                  {t('common:confirm')}
                </Button>
                <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => setConfirmId(null)}>
                  {t('common:cancel')}
                </Button>
              </div>
            ) : (
              <div className="shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  title={t('chat:archived.restore', { defaultValue: 'Restore' })}
                  disabled={isBusy}
                  onClick={() => void handleRestore(session.id)}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-md px-2 text-[length:var(--fs-xxs)]',
                    'text-text-400 hover:bg-bg-200 hover:text-text-100 transition-colors',
                    isBusy && 'opacity-50',
                  )}
                >
                  <UndoIcon size={13} />
                  <span>{t('chat:archived.restore', { defaultValue: 'Restore' })}</span>
                </button>
                <button
                  type="button"
                  title={t('chat:archived.delete', { defaultValue: 'Delete' })}
                  disabled={isBusy}
                  onClick={() => setConfirmId(session.id)}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-md px-2 text-[length:var(--fs-xxs)]',
                    'text-text-400 hover:bg-danger-100/10 hover:text-danger-100 transition-colors',
                    isBusy && 'opacity-50',
                  )}
                  data-session-id={rawId}
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
