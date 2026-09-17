import { describe, expect, it } from 'vitest'
import { getSelectionRoundClass } from './selectionRound'

describe('getSelectionRoundClass', () => {
  it('always returns a full radius regardless of neighbours', () => {
    // 回归保护：历史实现会在连续选中时返回 rounded-none / rounded-t-* / rounded-b-*，
    // 但由于列表行之间始终有间距，拼接效果不成立，只会让选中块缺角。
    expect(getSelectionRoundClass(true, false, false)).toBe('rounded-md')
    expect(getSelectionRoundClass(true, true, true)).toBe('rounded-md')
    expect(getSelectionRoundClass(true, true, false)).toBe('rounded-md')
    expect(getSelectionRoundClass(true, false, true)).toBe('rounded-md')
    expect(getSelectionRoundClass(false, false, false)).toBe('rounded-md')
  })

  it('honours the lg radius for larger rows', () => {
    expect(getSelectionRoundClass(true, true, true, 'lg')).toBe('rounded-lg')
    expect(getSelectionRoundClass(false, false, false, 'lg')).toBe('rounded-lg')
  })
})
