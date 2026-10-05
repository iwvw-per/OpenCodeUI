// ============================================
// singleFlight - 同 key 在途请求合并
//
// 多个组件/多个 effect 可能在同一帧内请求同一份数据，此时它们都未命中缓存，
// 于是同一个请求被并发发出多次。后端繁忙时这些重复请求会互相排队，
// 把本来 1 秒的响应拖成十几秒，并且占用浏览器的并发连接额度（同域上限约 6）。
//
// 同一个 key 的并发调用共享同一个 Promise，只发一次网络；请求结束后立即移除，
// 保证后续调用能拿到新数据（这里只做合并，不做缓存）。
// ============================================

const inflight = new Map<string, Promise<unknown>>()
const sharedInflight = new Map<string, Promise<unknown>>()

/**
 * 复用同 key 的在途请求。
 *
 * @param key 请求身份（应包含 serverId / 目录 / 查询参数等所有影响结果的维度）
 * @param factory 真正发起请求的函数，仅在无在途请求时调用
 */
export function singleFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const request = factory().finally(() => {
    // 只清理自己这一条，避免并发场景下误删后来者的登记
    if (inflight.get(key) === request) inflight.delete(key)
  })
  inflight.set(key, request)
  return request
}

/**
 * 复用同 key 的在途请求，但**不把底层请求与任何调用方的 signal 绑定**。
 *
 * 与 singleFlight 的区别：调用方各自的 AbortSignal 只影响自己（abort 后自己抛
 * AbortError），底层共享请求继续跑完并保留在登记表里，供其它在途调用方复用。
 *
 * 适用场景：StrictMode 双调用 / 多个组件同时请求同一份大响应（单次可达 MB 级），
 * 若用 singleFlight 的共享 signal 语义，一个调用方 abort（如切换会话）会把另一个
 * 仍在等待的调用方一起打断；若各自独立发请求，则同一响应被下载两次。
 */
export function sharedInflightRequest<T>(
  key: string,
  factory: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))

  let request = sharedInflight.get(key) as Promise<T> | undefined
  if (!request) {
    request = factory().finally(() => {
      if (sharedInflight.get(key) === request) sharedInflight.delete(key)
    })
    sharedInflight.set(key, request)
  }

  const shared = request
  if (!signal) return shared

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    shared.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** 测试用：清空在途登记 */
export function resetSingleFlight(): void {
  inflight.clear()
  sharedInflight.clear()
}
