import { beforeEach, describe, expect, it } from 'vitest'
import { todoStore } from './todoStore'
import type { TodoItem } from '../types/api/event'

function makeTodo(id: string, status: TodoItem['status'] = 'pending'): TodoItem {
  return { id, content: `task ${id}`, status, priority: 'medium' }
}

describe('todoStore defensive copying', () => {
  beforeEach(() => {
    todoStore.clearAll()
  })

  it('does not let mutating the passed-in array affect store state', () => {
    const input = [makeTodo('a'), makeTodo('b')]
    todoStore.setTodos('s1', input)

    input.push(makeTodo('c'))
    input[0]!.id = 'mutated'
    input.reverse()

    expect(todoStore.getTodos('s1').map(t => t.id)).toEqual(['a', 'b'])
    expect(todoStore.getStats('s1').total).toBe(2)
  })

  it('keeps an earlier snapshot intact after a later setTodos', () => {
    const first = [makeTodo('a')]
    todoStore.setTodos('s1', first)
    const storedFirst = todoStore.getTodos('s1')

    todoStore.setTodos('s1', [makeTodo('b'), makeTodo('c')])

    expect(storedFirst.map(t => t.id)).toEqual(['a'])
    expect(todoStore.getTodos('s1').map(t => t.id)).toEqual(['b', 'c'])
  })

  it('keeps stats in sync with the copied snapshot', () => {
    todoStore.setTodos('s1', [
      makeTodo('a', 'completed'),
      makeTodo('b', 'in_progress'),
      makeTodo('c'),
    ])

    expect(todoStore.getStats('s1')).toEqual({ total: 3, completed: 1, inProgress: 1 })
  })

  it('returns a frozen shared empty array for unknown sessions', () => {
    const empty = todoStore.getTodos('missing')
    expect(empty).toHaveLength(0)
    expect(Object.isFrozen(empty)).toBe(true)
    expect(todoStore.getTodos('missing')).toBe(empty)
  })

  it('keeps the frozen empty array stable across unrelated session updates', () => {
    const empty = todoStore.getTodos('missing')
    todoStore.setTodos('s1', [makeTodo('a')])
    expect(todoStore.getTodos('missing')).toBe(empty)
  })

  it('discards a stale HTTP snapshot when SSE wrote in between (D4)', () => {
    todoStore.setTodos('s1', [makeTodo('old')])
    // HTTP 快照请求发出前记录世代
    const revisionAtRequest = todoStore.getRevision('s1')
    // 期间 SSE 推来更新的 todo
    todoStore.setTodos('s1', [makeTodo('newer')])

    // 过时的 HTTP 快照回包：世代已变，应被丢弃
    todoStore.setTodos('s1', [makeTodo('old')], revisionAtRequest)

    expect(todoStore.getTodos('s1').map(t => t.id)).toEqual(['newer'])
  })

  it('applies an HTTP snapshot when nothing changed in between (D4)', () => {
    todoStore.setTodos('s1', [makeTodo('old')])
    const revisionAtRequest = todoStore.getRevision('s1')

    todoStore.setTodos('s1', [makeTodo('fresh')], revisionAtRequest)

    expect(todoStore.getTodos('s1').map(t => t.id)).toEqual(['fresh'])
  })
})
