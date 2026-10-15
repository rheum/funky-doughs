import { describe, expect, it } from 'vitest'
import { canReorderPreparationStep, canReorderPreparationStepToEnd, reorderPreparationStep } from './preparation'
import type { PreparationStep } from './types'

const step = (id: string, children: PreparationStep[] = []): PreparationStep => ({ id, text: id, children })

describe('preparation drag ordering', () => {
  it('moves a root step to the end of the list', () => {
    const result = reorderPreparationStep([step('one'), step('two'), step('three')], 'one')
    expect(result.map((item) => item.id)).toEqual(['two', 'three', 'one'])
  })

  it('moves a nested step to the end without losing its subtree', () => {
    const nested = step('sub', [step('sub-sub')])
    const result = reorderPreparationStep([step('one', [nested]), step('two')], 'sub')
    expect(result.map((item) => item.id)).toEqual(['one', 'two'])
    expect(result[0].children[0].id).toBe('sub')
    expect(result[0].children[0].children[0].id).toBe('sub-sub')
  })

  it('does not move a step into another level', () => {
    const result = reorderPreparationStep([step('one', [step('child')]), step('two')], 'two', 'child')
    expect(result.map((item) => item.id)).toEqual(['one', 'two'])
    expect(result[0].children.map((item) => item.id)).toEqual(['child'])
    expect(canReorderPreparationStep([step('one', [step('child')]), step('two')], 'two', 'child')).toBe(false)
  })

  it('reorders nested siblings and moves them to their own level end', () => {
    const reordered = reorderPreparationStep([step('one', [step('a'), step('b')])], 'b', 'a')
    expect(reordered[0].children.map((item) => item.id)).toEqual(['b', 'a'])
    const atEnd = reorderPreparationStep(reordered, 'b')
    expect(atEnd[0].children.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('does not accept a root step on a nested level end marker', () => {
    const steps = [step('root', [step('nested-a'), step('nested-b')]), step('other')]
    expect(canReorderPreparationStepToEnd(steps, 'other', 'nested-a')).toBe(false)
    expect(canReorderPreparationStepToEnd(steps, 'nested-a', 'nested-a')).toBe(true)
  })

  it('does not show a marker for the current position', () => {
    const steps = [step('one'), step('two'), step('three')]
    expect(canReorderPreparationStep(steps, 'two', 'two')).toBe(false)
    expect(canReorderPreparationStep(steps, 'two', 'three')).toBe(false)
    expect(canReorderPreparationStepToEnd(steps, 'three', 'one')).toBe(false)
  })
})
