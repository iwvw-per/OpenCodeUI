import { describe, expect, it } from 'vitest'
import { buildAutoSelectAnswers, canAutoSelect, pickRecommendedLabel } from './questionAutoSelect'
import type { ApiQuestionRequest } from '../api'

function makeRequest(questions: ApiQuestionRequest['questions']): ApiQuestionRequest {
  return { id: 'q-1', sessionID: 'session-1', questions } as ApiQuestionRequest
}

describe('pickRecommendedLabel', () => {
  it('prefers the option marked (Recommended)', () => {
    expect(
      pickRecommendedLabel({
        question: 'Pick one',
        header: 'Pick',
        options: [
          { label: 'Option A', description: '' },
          { label: 'Option B (Recommended)', description: '' },
        ],
      }),
    ).toBe('Option B (Recommended)')
  })

  it('matches the recommended marker case-insensitively', () => {
    expect(
      pickRecommendedLabel({
        question: 'Pick one',
        header: 'Pick',
        options: [{ label: 'Option A (recommended)', description: '' }],
      }),
    ).toBe('Option A (recommended)')
  })

  it('falls back to the first option when nothing is marked', () => {
    expect(
      pickRecommendedLabel({
        question: 'Pick one',
        header: 'Pick',
        options: [
          { label: 'First', description: '' },
          { label: 'Second', description: '' },
        ],
      }),
    ).toBe('First')
  })

  it('returns undefined when there are no options', () => {
    expect(pickRecommendedLabel({ question: 'Free form', header: 'Free', options: [] })).toBeUndefined()
  })
})

describe('buildAutoSelectAnswers', () => {
  it('builds one answer per question using the recommended label', () => {
    const request = makeRequest([
      {
        question: 'Q1',
        header: 'H1',
        options: [
          { label: 'A', description: '' },
          { label: 'B (Recommended)', description: '' },
        ],
      },
      {
        question: 'Q2',
        header: 'H2',
        options: [{ label: 'Only', description: '' }],
      },
    ])

    expect(buildAutoSelectAnswers(request)).toEqual([['B (Recommended)'], ['Only']])
  })

  it('yields an empty answer for questions without options', () => {
    const request = makeRequest([{ question: 'Free form', header: 'Free', options: [] }])
    expect(buildAutoSelectAnswers(request)).toEqual([[]])
  })
})

describe('canAutoSelect', () => {
  it('is true when at least one question has options', () => {
    const request = makeRequest([
      { question: 'Free form', header: 'Free', options: [] },
      { question: 'Q2', header: 'H2', options: [{ label: 'Only', description: '' }] },
    ])
    expect(canAutoSelect(request)).toBe(true)
  })

  it('is false when no question has options', () => {
    const request = makeRequest([{ question: 'Free form', header: 'Free', options: [] }])
    expect(canAutoSelect(request)).toBe(false)
  })
})
