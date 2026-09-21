// ============================================
// Permission & Question API Functions
// 基于 @opencode-ai/sdk: /permission, /question 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { formatPathForApi, directoryCacheKey } from '../utils/directoryUtils'
import { serverStore } from '../store/serverStore'
import { singleFlight } from '../utils/singleFlight'
import type { ApiPermissionRequest, PermissionReply, ApiQuestionRequest, QuestionAnswer } from './types'

/**
 * 全局待处理请求的合并键。
 * 目录用与传输格式无关的目录键，避免 pathMode 切换让同一目录算出两个 key。
 */
function pendingScopeKey(kind: 'permission' | 'question', directory?: string, serverId?: string): string {
  const sid = serverId ?? serverStore.getActiveServerId()
  return `${kind}:${sid}:${directoryCacheKey(directory)}`
}

// ============================================
// Permission API
// ============================================

/**
 * 获取待处理的权限请求列表
 *
 * 同一 (server, directory) 的并发调用共享一次网络请求：初始化、目录切换、
 * SSE 重连会各自触发一次全量拉取，不去重就会在同一帧发出多份相同请求。
 */
export async function getPendingPermissions(
  sessionId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiPermissionRequest[]> {
  const permissions = await singleFlight(pendingScopeKey('permission', directory, serverId), async () => {
    const sdk = getSDKClient(serverId)
    return unwrap(await sdk.permission.list({ directory: formatPathForApi(directory, serverId) }))
  })
  if (!sessionId) return permissions
  const target = resolveSessionTarget(sessionId, serverId)
  return permissions.filter((p: ApiPermissionRequest) => p.sessionID === target.sessionId)
}

/**
 * 回复权限请求
 */
export async function replyPermission(
  requestId: string,
  reply: PermissionReply,
  message?: string,
  directory?: string,
  sessionId?: string,
  serverId?: string,
): Promise<boolean> {
  const sdk = getSDKClient(serverId)

  if (sessionId) {
    const target = resolveSessionTarget(sessionId, serverId)
    unwrap(
      await sdk.permission.respond({
        sessionID: target.sessionId,
        permissionID: requestId,
        directory: formatPathForApi(directory, serverId),
        response: reply,
      }),
    )
    return true
  }

  unwrap(
    await sdk.permission.reply({
      requestID: requestId,
      directory: formatPathForApi(directory, serverId),
      reply,
      message,
    }),
  )
  return true
}

// ============================================
// Question API
// ============================================

/**
 * 获取待处理的问题请求列表
 *
 * 与 getPendingPermissions 同样做同 key 在途合并。
 */
export async function getPendingQuestions(
  sessionId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiQuestionRequest[]> {
  const questions = await singleFlight(pendingScopeKey('question', directory, serverId), async () => {
    const sdk = getSDKClient(serverId)
    return unwrap(await sdk.question.list({ directory: formatPathForApi(directory, serverId) }))
  })
  if (!sessionId) return questions
  const target = resolveSessionTarget(sessionId, serverId)
  return questions.filter((q: ApiQuestionRequest) => q.sessionID === target.sessionId)
}

/**
 * 回复问题请求
 */
export async function replyQuestion(
  requestId: string,
  answers: QuestionAnswer[],
  directory?: string,
  serverId?: string,
): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  unwrap(
    await sdk.question.reply({
      requestID: requestId,
      directory: formatPathForApi(directory, serverId),
      answers,
    }),
  )
  return true
}

/**
 * 拒绝问题请求
 */
export async function rejectQuestion(requestId: string, directory?: string, serverId?: string): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  unwrap(
    await sdk.question.reject({
      requestID: requestId,
      directory: formatPathForApi(directory, serverId),
    }),
  )
  return true
}
