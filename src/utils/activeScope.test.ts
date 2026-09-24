import { describe, expect, it } from 'vitest'
import { collectActiveDirectoriesByServer } from './activeScope'

describe('collectActiveDirectoriesByServer', () => {
  it('never mixes one server directories into another', () => {
    // 回归：此前是扁平列表，A 服务器的目录会被拿去查 B 服务器
    // （例如把 Linux 的 /root/x 发给 Windows 服务器）。
    const map = collectActiveDirectoriesByServer({
      activeServerId: 'win',
      routeServerId: 'linux',
      routeDirectory: '/root/app',
      currentDirectory: 'D:/work',
      panes: [
        { serverId: 'linux', directory: '/root/pane' },
        { serverId: 'win', directory: 'D:/pane' },
      ],
      projectDirectories: ['D:/proj-a'],
    })

    expect(map.get('linux')).toEqual(['/root/app', '/root/pane'])
    expect(map.get('win')).toEqual(['D:/work', 'D:/pane', 'D:/proj-a'])
    // 互不包含对方的路径
    expect(map.get('win')).not.toContain('/root/app')
    expect(map.get('linux')).not.toContain('D:/work')
  })

  it('falls back to the active server when a pane has no serverId', () => {
    const map = collectActiveDirectoriesByServer({
      activeServerId: 'local',
      panes: [{ directory: '/no-server' }],
    })
    expect(map.get('local')).toEqual(['/no-server'])
  })

  it('deduplicates within a single server', () => {
    const map = collectActiveDirectoriesByServer({
      activeServerId: 'local',
      currentDirectory: 'E:/Dev/Repo',
      projectDirectories: ['e:/DEV/repo', 'E:/dev/other'],
    })
    expect(map.get('local')).toEqual(['E:/Dev/Repo', 'E:/dev/other'])
  })

  it('returns an empty map when there is nothing to scope', () => {
    expect(collectActiveDirectoriesByServer({ activeServerId: 'local' }).size).toBe(0)
  })
})
