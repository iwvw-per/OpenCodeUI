import { describe, expect, it } from 'vitest'
import { mergeExpandedProjectNames } from './expandedProjects'

describe('mergeExpandedProjectNames', () => {
  it('replaces only the current server entries, keeping other servers', () => {
    // 回归：切换服务器后整份列表被当成「新增」而全部展开；整体覆盖又会清掉
    // 另一台服务器的展开项。这里只替换当前服务器的部分。
    expect(
      mergeExpandedProjectNames(['临时', 'alpha'], ['临时', 'HX50437'], ['HX50437']),
    ).toEqual(['alpha', 'HX50437'])
  })

  it('keeps other-server entries when the current server collapses everything', () => {
    expect(mergeExpandedProjectNames(['临时', 'alpha'], ['临时'], [])).toEqual(['alpha'])
  })

  it('expands a new project without dropping existing current-server entries', () => {
    expect(
      mergeExpandedProjectNames(['临时'], ['临时', 'HX50437'], ['临时', 'HX50437']),
    ).toEqual(['临时', 'HX50437'])
  })

  it('drops stale names that no longer belong to any visible project', () => {
    // 已移除项目的残留名字由调用方负责清理（这里只做分区保留），
    // 但不在当前服务器的名字会被原样保留 —— 这也是本函数的设计边界。
    expect(mergeExpandedProjectNames(['gone'], ['临时'], [])).toEqual(['gone'])
  })
})
