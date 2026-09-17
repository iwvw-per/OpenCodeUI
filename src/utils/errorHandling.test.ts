import { afterEach, describe, expect, it, vi } from 'vitest'
import { logError, withErrorHandling } from './errorHandling'

describe('logError', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('outputs the error object and details', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')
    const details = { url: '/api/session' }

    logError(error, { category: 'api', operation: 'load sessions', details })

    expect(spy).toHaveBeenCalledTimes(1)
    const [prefix, loggedError, loggedDetails] = spy.mock.calls[0]
    expect(prefix).toBe('[api] load sessions:')
    expect(loggedError).toBe(error)
    expect(loggedDetails).toBe(details)
  })

  it('still logs when silent is set — silent only suppresses user-facing hints', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')

    logError(error, { category: 'ui', operation: 'background refresh', silent: true })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('[ui] background refresh:')
  })

  it('does not append a details argument when details is undefined', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logError(new Error('boom'), { category: 'parse', operation: 'parse json' })

    expect(spy.mock.calls[0]).toHaveLength(2)
  })
})

describe('withErrorHandling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the resolved value', async () => {
    await expect(withErrorHandling(async () => 42, { category: 'api', operation: 'ok' })).resolves.toBe(42)
  })

  it('logs and returns undefined on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')

    await expect(withErrorHandling(async () => Promise.reject(error), { category: 'api', operation: 'fail' })).resolves.toBeUndefined()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe(error)
  })
})
