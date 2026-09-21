// ============================================
// Agent API Functions
// 基于 @opencode-ai/sdk: /agent 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi, directoryCacheKey } from '../utils/directoryUtils'
import { singleFlight } from '../utils/singleFlight'
import { serverStore } from '../store/serverStore'
import type { ApiAgent } from './types'

/**
 * 获取 agent 列表
 *
 * 首屏 useChatSession 与输入框能力探测会各取一次；合并同 key 在途请求。
 * key 用与传输格式无关的目录键，避免 pathMode 切换导致重复请求。
 */
export async function getAgents(directory?: string, serverId?: string): Promise<ApiAgent[]> {
  const sid = serverId ?? serverStore.getActiveServerId()
  return singleFlight(`agents:${sid}:${directoryCacheKey(directory)}`, async () => {
    const sdk = getSDKClient(serverId)
    return unwrap(await sdk.app.agents({ directory: formatPathForApi(directory, serverId) }))
  })
}

/**
 * 获取可选择的 agent 列表（过滤掉 hidden 的）
 */
export async function getSelectableAgents(directory?: string, serverId?: string): Promise<ApiAgent[]> {
  const agents = await getAgents(directory, serverId)
  return agents.filter(agent => !agent.hidden)
}
