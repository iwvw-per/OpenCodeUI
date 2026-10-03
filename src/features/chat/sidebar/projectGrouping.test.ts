import { describe, expect, it } from 'vitest'
import type { GitWorkspaceMeta } from '../../../hooks'
import { getProjectGroupIdentity, sortProjectsByMode } from './projectGrouping'

const gitMeta: GitWorkspaceMeta = {
  isGit: true,
  rootDirectory: '/workspace/project-root',
  workspaces: ['/workspace/project-root', '/workspace/project-worktree'],
}

describe('getProjectGroupIdentity', () => {
  it('keeps a saved git subdirectory as its own project path', () => {
    expect(getProjectGroupIdentity('/workspace/project-root/subdir-a/subdir-b', gitMeta)).toEqual({
      projectId: '/workspace/project-root/subdir-a/subdir-b',
      workspaceDirectories: undefined,
    })
  })

  it('groups actual git workspace roots by git root', () => {
    expect(getProjectGroupIdentity('/workspace/project-worktree', gitMeta)).toEqual({
      projectId: '/workspace/project-root',
      workspaceDirectories: ['/workspace/project-root', '/workspace/project-worktree'],
    })
  })
})

describe('sortProjectsByMode', () => {
  const projects = [
    { name: 'Beta', worktree: 'C:/beta', addedAt: 3 },
    { name: 'Alpha', worktree: 'C:/alpha', addedAt: 1 },
    { name: 'Gamma', worktree: 'C:/gamma', addedAt: 2 },
  ]

  it('manual mode preserves the given order (drag order)', () => {
    const result = sortProjectsByMode(projects, 'manual', 'created', { 'C:/alpha': 999 }, true)
    expect(result.map(p => p.name)).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('auto mode with updated field sorts by last used time desc', () => {
    const result = sortProjectsByMode(
      projects,
      'auto',
      'updated',
      { 'C:/alpha': 100, 'C:/beta': 300, 'C:/gamma': 200 },
      true,
    )
    expect(result.map(p => p.name)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('auto mode with updated field sorts ascending when desc is false', () => {
    const result = sortProjectsByMode(
      projects,
      'auto',
      'updated',
      { 'C:/alpha': 100, 'C:/beta': 300, 'C:/gamma': 200 },
      false,
    )
    expect(result.map(p => p.name)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('auto mode with created field sorts by stable addedAt, ignoring last used', () => {
    // last used 的顺序与 addedAt 相反，用来证明 created 不看活动时间
    const result = sortProjectsByMode(
      projects,
      'auto',
      'created',
      { 'C:/alpha': 999, 'C:/beta': 1, 'C:/gamma': 500 },
      true,
    )
    expect(result.map(p => p.name)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('auto mode with created field is stable under session activity', () => {
    const before = sortProjectsByMode(projects, 'auto', 'created', {}, true)
    const after = sortProjectsByMode(projects, 'auto', 'created', { 'C:/alpha': Date.now() }, true)
    expect(after.map(p => p.name)).toEqual(before.map(p => p.name))
  })

  it('auto mode falls back to name for equal timestamps', () => {
    const noTime = projects.map(p => ({ ...p, addedAt: 0 }))
    const result = sortProjectsByMode(noTime, 'auto', 'created', {}, true)
    expect(result.map(p => p.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('does not mutate the input array', () => {
    const input = [...projects]
    sortProjectsByMode(input, 'auto', 'updated', { 'C:/alpha': 100 }, true)
    expect(input.map(p => p.name)).toEqual(['Beta', 'Alpha', 'Gamma'])
  })
})
