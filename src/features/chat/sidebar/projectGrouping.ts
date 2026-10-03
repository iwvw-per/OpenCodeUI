import type { GitWorkspaceMeta } from '../../../hooks'
import { isSameDirectory, normalizeToForwardSlash, type SessionSortField } from '../../../utils'

export function isWorkspaceRootDirectory(directory: string, meta: GitWorkspaceMeta | undefined) {
  if (!meta?.isGit) return false
  return meta.workspaces.some(workspace => isSameDirectory(workspace, directory))
}

export function getProjectGroupIdentity(directory: string, meta: GitWorkspaceMeta | undefined) {
  const normalizedDirectory = normalizeToForwardSlash(directory)

  if (isWorkspaceRootDirectory(normalizedDirectory, meta) && meta) {
    return {
      projectId: meta.rootDirectory,
      workspaceDirectories: meta.workspaces,
    }
  }

  return {
    projectId: normalizedDirectory,
    workspaceDirectories: undefined,
  }
}

interface SortableProject {
  worktree?: string
  name: string
  /** 项目被保存到侧栏的时间（稳定，不随会话活动变化） */
  addedAt?: number
}

/**
 * 项目文件夹排序（仅作用于「已保存项目」，派生项目由调用方剥离）。
 *
 * - created：按项目保存时间排序。保存时间是稳定值，会话活动不会改变它。
 * - updated：按最后一次对话时间排序（用户最后一条消息的锚点，单调只增，
 *   多个会话并行运行时也不会来回跳）。
 *
 * 时间相同按名称兜底，保证稳定。纯函数，便于单测。
 */
export function sortProjects<T extends SortableProject>(
  projects: T[],
  field: SessionSortField,
  lastUsedAt: Record<string, number>,
  desc: boolean,
): T[] {
  const sortTime = (project: SortableProject): number => {
    if (field === 'created') return project.addedAt ?? 0
    return lastUsedAt[normalizeToForwardSlash(project.worktree || '')] ?? 0
  }

  return [...projects].sort((a, b) => {
    const ta = sortTime(a)
    const tb = sortTime(b)
    if (ta !== tb) return desc ? tb - ta : ta - tb
    return a.name.localeCompare(b.name)
  })
}
