import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepFinishPartView } from './StepFinishPartView'
import type { StepFinishPart } from '../../../types/message'

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    stepFinishDisplay: {
      latestOnly: true,
      turnDuration: false,
      tokens: true,
      cache: true,
      cost: true,
      duration: true,
      agent: false,
      model: false,
      completedAt: false,
    },
    completedAtFormat: 'time',
  }),
}))

function makePart(): StepFinishPart {
  return {
    id: 'step-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'step-finish',
    tokens: { input: 1000, output: 5000, reasoning: 0, cache: { read: 234_100, write: 0 } },
    cost: 0,
  } as StepFinishPart
}

describe('StepFinishPartView', () => {
  it('renders the cached count at the same tone as the rest of the stats row', () => {
    // 回归：cached 曾单独用 text-text-600（主题里该色标注为「分隔线」），
    // 比整行 text-text-500 更淡，在深色主题下几乎看不清。
    const { container } = render(<StepFinishPartView part={makePart()} />)
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('text-text-500')

    const cached = screen.getByText(/cached/)
    expect(cached.className).not.toContain('text-text-600')
  })
})
