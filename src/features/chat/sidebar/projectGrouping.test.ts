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
    { name: 'Beta', worktree: 'C:/beta' },
    { name: 'Alpha', worktree: 'C:/alpha' },
    { name: 'Gamma', worktree: 'C:/gamma' },
  ]

  it('manual mode preserves the given order (drag order)', () => {
    const result = sortProjectsByMode(projects, 'manual', { 'C:/alpha': 999 }, true)
    expect(result.map(p => p.name)).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('auto mode sorts by last used time desc', () => {
    const result = sortProjectsByMode(projects, 'auto', { 'C:/alpha': 100, 'C:/beta': 300, 'C:/gamma': 200 }, true)
    expect(result.map(p => p.name)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('auto mode sorts ascending when desc is false', () => {
    const result = sortProjectsByMode(projects, 'auto', { 'C:/alpha': 100, 'C:/beta': 300, 'C:/gamma': 200 }, false)
    expect(result.map(p => p.name)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('auto mode falls back to name for equal timestamps', () => {
    const result = sortProjectsByMode(projects, 'auto', {}, true)
    expect(result.map(p => p.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('does not mutate the input array', () => {
    const input = [...projects]
    sortProjectsByMode(input, 'auto', { 'C:/alpha': 100 }, true)
    expect(input.map(p => p.name)).toEqual(['Beta', 'Alpha', 'Gamma'])
  })
})
