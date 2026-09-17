import { beforeEach, describe, expect, it } from 'vitest'
import { serviceStore } from './serviceStore'

describe('serviceStore envVars defensive copying', () => {
  beforeEach(() => {
    serviceStore.setEnvVars([])
  })

  it('does not reflect later mutations of the array passed to setEnvVars', () => {
    const input = [
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]
    serviceStore.setEnvVars(input)

    input.push({ key: 'C', value: '3' })
    input[0]!.key = 'mutated'

    expect(serviceStore.envVars.map(item => item.key)).toEqual(['A', 'B'])
    expect(serviceStore.envVarsRecord).toEqual({ A: '1', B: '2' })
  })

  it('rebuilds a fresh snapshot after setEnvVars', () => {
    const before = serviceStore.getSnapshot()
    serviceStore.setEnvVars([{ key: 'A', value: '1' }])
    const after = serviceStore.getSnapshot()

    expect(after).not.toBe(before)
    expect(after.envVars).toEqual([{ key: 'A', value: '1' }])
  })
})
