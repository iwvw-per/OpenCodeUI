import { isSameDirectory } from './directoryUtils'

interface CollectActiveDirectoriesByServerOptions {
  /** 活动服务器：currentDirectory 与已保存项目都归它 */
  activeServerId: string | null | undefined
  /** 路由所在服务器（可能与活动服务器不同，如从链接直接打开） */
  routeServerId?: string | null
  routeDirectory?: string
  currentDirectory?: string
  /** 各 pane 的目录及其所属服务器（缺 serverId 时归活动服务器） */
  panes?: Array<{ serverId?: string | null; directory?: string }>
  /** 活动服务器的已保存项目目录 */
  projectDirectories?: string[]
}

/**
 * 按服务器收集「需要拉取会话状态」的目录。
 *
 * 目录属于各自的服务器：把 A 服务器的路径拿去查 B 服务器既无意义（路径在其
 * 文件系统上不存在），又会白白多发请求。这里按 serverId 分组，调用方只对
 * 每台服务器查它自己的目录。同一服务器内按目录去重。
 */
export function collectActiveDirectoriesByServer({
  activeServerId,
  routeServerId,
  routeDirectory,
  currentDirectory,
  panes = [],
  projectDirectories = [],
}: CollectActiveDirectoriesByServerOptions): Map<string, string[]> {
  const byServer = new Map<string, string[]>()
  const fallbackServerId = activeServerId ?? ''

  const push = (serverId: string | null | undefined, directory?: string) => {
    if (!serverId || !directory) return
    const list = byServer.get(serverId) ?? []
    if (list.some(existing => isSameDirectory(existing, directory))) return
    list.push(directory)
    byServer.set(serverId, list)
  }

  push(routeServerId || fallbackServerId, routeDirectory)
  push(fallbackServerId, currentDirectory)
  for (const pane of panes) push(pane.serverId || fallbackServerId, pane.directory)
  for (const directory of projectDirectories) push(fallbackServerId, directory)

  return byServer
}
