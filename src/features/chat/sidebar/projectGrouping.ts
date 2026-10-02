import type { GitWorkspaceMeta } from '../../../hooks'
import { isSameDirectory, normalizeToForwardSlash } from '../../../utils'

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
}

/**
 * 项目文件夹排序：
 * - manual：保持传入顺序（即用户拖拽保存的 saved-directories 顺序）
 * - auto：按最后使用时间排序，方向由 desc 决定；时间相同按名称兜底，保证稳定
 *
 * 纯函数，便于单测。auto 是默认行为，manual 只在用户拖拽过项目后启用。
 */
export function sortProjectsByMode<T extends SortableProject>(
  projects: T[],
  mode: 'auto' | 'manual',
  lastUsedAt: Record<string, number>,
  desc: boolean,
): T[] {
  if (mode === 'manual') return projects

  const lastUsed = (project: SortableProject): number =>
    lastUsedAt[normalizeToForwardSlash(project.worktree || '')] ?? 0

  return [...projects].sort((a, b) => {
    const ta = lastUsed(a)
    const tb = lastUsed(b)
    if (ta !== tb) return desc ? tb - ta : ta - tb
    return a.name.localeCompare(b.name)
  })
}
