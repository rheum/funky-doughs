import type { PreparationStep } from './types'

const reorderDirectChildren = (steps: PreparationStep[], sourceId: string, targetId?: string): PreparationStep[] | null => {
  const sourceIndex = steps.findIndex((step) => step.id === sourceId)
  if (sourceIndex < 0) return null
  const moving = steps[sourceIndex]
  const remaining = steps.filter((step) => step.id !== sourceId)
  if (!targetId) return [...remaining, moving]
  const targetIndex = remaining.findIndex((step) => step.id === targetId)
  if (targetIndex < 0) return null
  remaining.splice(targetIndex, 0, moving)
  return remaining
}

export const canReorderPreparationStep = (steps: PreparationStep[], sourceId: string, targetId?: string): boolean => {
  if (sourceId === targetId) return false
  const sourceIndex = steps.findIndex((step) => step.id === sourceId)
  const targetIndex = targetId ? steps.findIndex((step) => step.id === targetId) : -1
  if (sourceIndex >= 0 && targetId && targetIndex >= 0) return sourceIndex !== targetIndex && sourceIndex + 1 !== targetIndex
  return steps.some((step) => canReorderPreparationStep(step.children || [], sourceId, targetId))
}

export const canReorderPreparationStepToEnd = (steps: PreparationStep[], sourceId: string, referenceId: string): boolean => {
  if (steps.some((step) => step.id === referenceId)) return steps.findIndex((step) => step.id === sourceId) >= 0 && steps.findIndex((step) => step.id === sourceId) !== steps.length - 1
  return steps.some((step) => canReorderPreparationStepToEnd(step.children || [], sourceId, referenceId))
}

export const reorderPreparationStep = (steps: PreparationStep[], sourceId: string, targetId?: string): PreparationStep[] => {
  const directResult = reorderDirectChildren(steps, sourceId, targetId)
  if (directResult) return directResult
  return steps.map((step) => ({ ...step, children: reorderPreparationStep(step.children || [], sourceId, targetId) }))
}
