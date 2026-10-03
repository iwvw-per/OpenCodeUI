import { describe, expect, it } from 'vitest'
import type { GitWorkspaceMeta } from '../../../hooks'
import { getProjectGroupIdentity, sortProjects } from './projectGrouping'

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

describe('sortProjects', () => {
  const projects = [
    { name: 'Beta', worktree: 'C:/beta', addedAt: 3 },
    { name: 'Alpha', worktree: 'C:/alpha', addedAt: 1 },
    { name: 'Gamma', worktree: 'C:/gamma', addedAt: 2 },
  ]

  it('sorts by last used time desc when field is updated', () => {
    const result = sortProjects(
      projects,
      'updated',
      { 'C:/alpha': 100, 'C:/beta': 300, 'C:/gamma': 200 },
      true,
    )
    expect(result.map(p => p.name)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('sorts ascending when desc is false', () => {
    const result = sortProjects(
      projects,
      'updated',
      { 'C:/alpha': 100, 'C:/beta': 300, 'C:/gamma': 200 },
      false,
    )
    expect(result.map(p => p.name)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('sorts by stable addedAt, ignoring last used, when field is created', () => {
    // last used 的顺序与 addedAt 相反，用来证明 created 不看活动时间
    const result = sortProjects(
      projects,
      'created',
      { 'C:/alpha': 999, 'C:/beta': 1, 'C:/gamma': 500 },
      true,
    )
    expect(result.map(p => p.name)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('is stable under session activity when field is created', () => {
    const before = sortProjects(projects, 'created', {}, true)
    const after = sortProjects(projects, 'created', { 'C:/alpha': Date.now() }, true)
    expect(after.map(p => p.name)).toEqual(before.map(p => p.name))
  })

  it('falls back to name for equal timestamps', () => {
    const noTime = projects.map(p => ({ ...p, addedAt: 0 }))
    const result = sortProjects(noTime, 'created', {}, true)
    expect(result.map(p => p.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('does not mutate the input array', () => {
    const input = [...projects]
    sortProjects(input, 'updated', { 'C:/alpha': 100 }, true)
    expect(input.map(p => p.name)).toEqual(['Beta', 'Alpha', 'Gamma'])
  })
})
