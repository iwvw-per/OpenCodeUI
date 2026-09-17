import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { SettingsSection, settingsFieldClass } from './SettingsUI'
import {
  login as accountLogin,
  logout as accountLogout,
  readAccount,
  syncInstances,
  selectInstance,
  type AiAgentAccount,
  type AiAgentInstance,
} from '../../../api/aiagent'
import {
  getSyncState,
  startPreferencesSync,
  stopPreferencesSync,
  subscribeSyncState,
  syncNow,
  type SyncState,
} from '../../../api/preferencesSyncEngine'
import { isSyncEnabled, setSyncEnabled } from '../../../api/preferencesSync'
import { useServerStore } from '../../../hooks'

function formatSyncedAt(timestamp: number): string {
  if (!timestamp) return '尚未同步'
  return new Date(timestamp).toLocaleTimeString()
}

function describeSyncState(state: SyncState): string {
  switch (state.status) {
    case 'syncing':
      return '同步中…'
    case 'synced':
      return `已同步 · ${formatSyncedAt(state.lastSyncedAt)}`
    case 'error':
      return `同步失败：${state.error || '未知错误'}`
    case 'disabled':
      return '未启用'
    default:
      return '待同步'
  }
}

/** AI Agent 账号：连接 API Monitor 的 aiagent 模块，同步实例为可切换服务器。 */
export function AiAgentAccountSettings() {
  const [account, setAccount] = useState<AiAgentAccount | null>(() => readAccount())
  const [domain, setDomain] = useState(account?.domain ?? '')
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
  const [instances, setInstances] = useState<AiAgentInstance[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [syncEnabled, setSyncEnabledState] = useState(() => isSyncEnabled())
  const [syncState, setSyncState] = useState<SyncState>(() => getSyncState())
  const { activeServer, getHealth, checkHealth } = useServerStore()

  useEffect(() => subscribeSyncState(setSyncState), [])

  const handleToggleSync = useCallback(
    async (enabled: boolean) => {
      setSyncEnabled(enabled)
      setSyncEnabledState(enabled)
      if (enabled) {
        await startPreferencesSync()
      } else {
        stopPreferencesSync()
      }
    },
    [],
  )

  const refreshInstances = useCallback(
    async (target?: AiAgentAccount | null) => {
      try {
        const list = await syncInstances(target)
        setInstances(list)
        // 实例状态以「能否经网关访问到服务」为准：列表接口默认不做实时探测
        // （返回的 online 恒为 false），这里逐个跑一次真实健康检查。
        await Promise.all(list.map(instance => checkHealth(`aiagent:${instance.id}`)))
      } catch (err) {
        setError(err instanceof Error ? err.message : '同步实例失败')
      }
    },
    [checkHealth],
  )

  useEffect(() => {
    if (account) {
      void refreshInstances(account)
    }
  }, [account, refreshInstances])

  const handleLogin = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const next = await accountLogin(domain, username, password, '客户端')
      setPassword('')
      setAccount(next)
      if (isSyncEnabled()) {
        await startPreferencesSync()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }, [domain, username, password])

  const handleLogout = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      stopPreferencesSync()
      await accountLogout()
      setAccount(null)
      setInstances([])
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '退出失败')
    } finally {
      setBusy(false)
    }
  }, [])

  const handleSwitch = useCallback(
    (instance: AiAgentInstance) => {
      if (!selectInstance(instance)) {
        setError('切换失败：实例服务器未登记')
      }
    },
    [],
  )

  return (
    <SettingsSection
      title="AI Agent 账号"
      description="登录 API Monitor 账号后，自动同步你名下的 AI Agent 实例，并在这些机器之间切换。数据经主机 Agent 的原生流通道转发，不需要开放公网端口。"
    >
      {!account ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-300">
            面板域名
            <input
              className={settingsFieldClass}
              value={domain}
              placeholder="panel.example.com"
              autoComplete="off"
              onChange={event => setDomain(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-300">
            用户名
            <input
              className={settingsFieldClass}
              value={username}
              autoComplete="username"
              onChange={event => setUsername(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-300">
            密码
            <input
              className={settingsFieldClass}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={event => setPassword(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button onClick={handleLogin} disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </Button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-300">
            <span>
              已登录 <span className="text-text-100">{account.username}</span> @ {account.domain}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => refreshInstances(account)} disabled={busy}>
                刷新实例
              </Button>
              <Button variant="ghost" onClick={handleLogout} disabled={busy}>
                退出登录
              </Button>
            </div>
          </div>

          {instances.length === 0 ? (
            <p className="text-xs text-text-500">该账号下还没有登记实例。请先在面板的 AI Agent 模块添加。</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {instances.map(instance => {
                const serverId = `aiagent:${instance.id}`
                const isActive = activeServer?.id === serverId
                const health = getHealth(serverId)
                const online = health?.status === 'online'
                const offlineLabel = health?.error || instance.status?.error || ''
                return (
                  <li
                    key={instance.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-100 bg-bg-100 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-text-100">{instance.label}</span>
                        <span
                          className={`text-[10px] ${online ? 'text-green-400' : 'text-text-500'}`}
                          title={offlineLabel}
                        >
                          {online ? '运行中' : '离线'}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-text-500">
                        {instance.providerLabel || instance.provider} · {instance.hostName || instance.serverId} ·{' '}
                        {instance.port}
                      </div>
                    </div>
                    <Button
                      variant={isActive ? 'secondary' : 'ghost'}
                      disabled={isActive}
                      onClick={() => handleSwitch(instance)}
                    >
                      {isActive ? '当前' : '切换'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}

          <div className="flex flex-col gap-2 rounded-lg border border-border-100 bg-bg-100 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-text-100">设置同步</div>
                <div className="text-[11px] text-text-500">{describeSyncState(syncState)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  disabled={!syncEnabled || busy || syncState.status === 'syncing'}
                  onClick={() => void syncNow()}
                >
                  立即同步
                </Button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={syncEnabled}
                  aria-label="启用设置同步"
                  onClick={() => void handleToggleSync(!syncEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    syncEnabled ? 'bg-accent-main-100' : 'bg-bg-300'
                  }`}
                >
                  <span
                    className={`inline-block size-4 rounded-full bg-bg-000 transition-transform ${
                      syncEnabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-text-500">
              开启后，主题、布局、快捷键、项目与会话偏好等本地设置会自动同步到面板，在这台设备与其它设备之间保持一致。
            </p>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
