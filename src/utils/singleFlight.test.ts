import { describe, expect, it, vi } from 'vitest'
import { sharedInflightRequest, resetSingleFlight } from './singleFlight'

describe('sharedInflightRequest', () => {
  it('dedupes concurrent calls with the same key into one network request', async () => {
    resetSingleFlight()
    const factory = vi.fn(async () => {
      await Promise.resolve()
      return 'value'
    })

    const [a, b] = await Promise.all([
      sharedInflightRequest('k', factory),
      sharedInflightRequest('k', factory),
    ])

    expect(a).toBe('value')
    expect(b).toBe('value')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('does not let one caller abort kill another', async () => {
    resetSingleFlight()
    let release!: (value: string) => void
    const factory = () => new Promise<string>(resolve => (release = resolve))

    const controller = new AbortController()
    const aborted = sharedInflightRequest('k2', factory, controller.signal)
    const survivor = sharedInflightRequest('k2', factory)

    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    release('done')
    await expect(survivor).resolves.toBe('done')
  })

  it('rejects immediately when the caller signal is already aborted', async () => {
    resetSingleFlight()
    const factory = vi.fn(async () => 'x')
    const controller = new AbortController()
    controller.abort()

    await expect(sharedInflightRequest('k3', factory, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(factory).not.toHaveBeenCalled()
  })

  it('removes the registration after settle so later calls refetch', async () => {
    resetSingleFlight()
    const factory = vi.fn(async () => 'v')
    await sharedInflightRequest('k4', factory)
    await sharedInflightRequest('k4', factory)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
