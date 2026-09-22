// ============================================
// questionAutoSelect - 提问超时自动选择
//
// 约定：opencode 的 question 工具要求「推荐项放第一位，并在标签末尾加
// (Recommended)」。没有推荐标记时退化为第一个选项。
// ============================================

import type { ApiQuestionInfo, ApiQuestionRequest, QuestionAnswer } from '../api'

const RECOMMENDED_PATTERN = /\(\s*recommended\s*\)/i

/**
 * 从单个问题的选项里挑出推荐项：优先带 (Recommended) 标记的，否则第一个。
 */
export function pickRecommendedLabel(question: ApiQuestionInfo): string | undefined {
  const options = question.options ?? []
  if (options.length === 0) return undefined
  const recommended = options.find(option => RECOMMENDED_PATTERN.test(option.label))
  return (recommended ?? options[0]).label
}

/**
 * 为一个提问请求构造超时自动提交的答案。
 *
 * 多选题目只提交推荐项一个，单选同样；题目没有任何选项时返回空数组，
 * 由调用方决定是否改为跳过。
 */
export function buildAutoSelectAnswers(request: ApiQuestionRequest): QuestionAnswer[] {
  return request.questions.map(question => {
    const label = pickRecommendedLabel(question)
    return label === undefined ? [] : [label]
  })
}

/**
 * 是否存在至少一个可自动作答的选项。
 */
export function canAutoSelect(request: ApiQuestionRequest): boolean {
  return request.questions.some(question => pickRecommendedLabel(question) !== undefined)
}
