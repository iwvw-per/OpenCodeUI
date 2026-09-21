import { beforeEach, describe, expect, it, vi } from 'vitest'
import { singleFlight, resetSingleFlight } from './singleFlight'

describe('singleFlight', () => {
  beforeEach(() => {
    resetSingleFlight()
  })

  it('shares one in-flight request across concurrent callers with the same key', async () => {
    const resolvers: Array<(value: string) => void> = []
    const factory = vi.fn(
      () =>
        new Promise<string>(r => {
          resolvers.push(r)
        }),
    )

    const first = singleFlight('k', factory)
    const second = singleFlight('k', factory)

    expect(factory).toHaveBeenCalledTimes(1)
    resolvers[0]('value')

    await expect(first).resolves.toBe('value')
    await expect(second).resolves.toBe('value')
  })

  it('does not share across different keys', async () => {
    const factory = vi.fn(async () => 'v')
    await Promise.all([singleFlight('a', factory), singleFlight('b', factory)])
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('issues a fresh request once the previous one settled', async () => {
    const factory = vi.fn(async () => 'v')
    await singleFlight('k', factory)
    await singleFlight('k', factory)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('clears the entry when the request rejects, so retries can proceed', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(singleFlight('k', failing)).rejects.toThrow('boom')

    const succeeding = vi.fn(async () => 'ok')
    await expect(singleFlight('k', succeeding)).resolves.toBe('ok')
    expect(succeeding).toHaveBeenCalledTimes(1)
  })
})
