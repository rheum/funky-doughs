import type { Ingredient, Recipe } from './types'

export type RecipeCalculations = {
  hydration: number
  ta: number
  sourdough: number
  totalFlourGrams: number
  ingredientGrams: Record<string, number>
}

const round = (value: number) => Math.round(value * 10) / 10
const ingredientFactor = (item: Ingredient) => item.kind === 'sourdough' ? Math.max(100, item.sourdoughTa || 200) / 100 : 1
const containsFlour = (item: Ingredient) => item.kind === 'flour' || item.kind === 'sourdough'
const precise = (value: number) => Math.round(value * 1e9) / 1e9

export function totalFlourPercentage(recipe: Recipe) {
  return recipe.ingredients.filter(containsFlour).reduce((sum, item) => sum + item.percentage / ingredientFactor(item), 0)
}

export function migrateSourdoughPercentages(recipe: Recipe): Recipe {
  const migrated: Recipe = recipe.sourdoughPercentageBasis === 'total' ? recipe : {
    ...recipe,
    sourdoughPercentageBasis: 'total',
    ingredients: recipe.ingredients.map((item) => item.kind === 'sourdough'
      ? { ...item, percentage: precise(item.percentage * ingredientFactor(item)) } : item),
  }
  const flour = migrated.ingredients.filter(containsFlour)
  if (!flour.length || flour.some((item) => !item.locked)) return migrated
  return { ...migrated, ingredients: migrated.ingredients.map((item) => item.id === flour[0].id ? { ...item, locked: false } : item) }
}

export function setIngredientLocked(recipe: Recipe, id: string, locked: boolean): Recipe {
  const edited = recipe.ingredients.find((item) => item.id === id)
  if (!edited) return recipe
  if (locked && containsFlour(edited) && !recipe.ingredients.some((item) => item.id !== id && containsFlour(item) && !item.locked)) return recipe
  return { ...recipe, ingredients: recipe.ingredients.map((item) => item.id === id ? { ...item, locked } : item) }
}

export function canRemoveRecipeIngredient(recipe: Recipe, id: string) {
  const edited = recipe.ingredients.find((item) => item.id === id)
  return !!edited && !edited.locked && (!containsFlour(edited) || recipe.ingredients.some((item) => item.id !== id && containsFlour(item) && !item.locked))
}

export function rebalanceFreeFlour(recipe: Recipe, editedId?: string): Recipe {
  const lockedShare = recipe.ingredients.filter((item) => containsFlour(item) && item.locked)
    .reduce((sum, item) => sum + item.percentage / ingredientFactor(item), 0)
  const budget = Math.max(0, 100 - lockedShare)
  const free = recipe.ingredients.filter((item) => containsFlour(item) && !item.locked)
  const edited = free.find((item) => item.id === editedId)
  const others = free.filter((item) => item.id !== editedId)
  const shares = new Map(others.map((item) => [item.id, Math.max(0, item.percentage / ingredientFactor(item))]))
  const editedShare = edited ? (others.length ? Math.max(0, Math.min(budget, edited.percentage / ingredientFactor(edited))) : budget) : 0
  let remaining = budget - editedShare - [...shares.values()].reduce((sum, value) => sum + value, 0)
  while (Math.abs(remaining) > 1e-9) {
    const eligible = others.filter((item) => remaining > 0 || shares.get(item.id)! > 1e-9)
    if (!eligible.length) break
    const adjustment = remaining / eligible.length
    for (const item of eligible) {
      const current = shares.get(item.id)!
      const change = Math.max(-current, adjustment)
      shares.set(item.id, current + change)
      remaining -= change
    }
  }
  if (edited) shares.set(edited.id, editedShare)
  return { ...recipe, ingredients: recipe.ingredients.map((item) => shares.has(item.id)
    ? { ...item, percentage: precise(shares.get(item.id)! * ingredientFactor(item)) } : item) }
}

export function updateIngredientPercentage(recipe: Recipe, id: string, percentage: number): Recipe {
  const edited = recipe.ingredients.find((item) => item.id === id)
  if (!edited || edited.locked || !Number.isFinite(percentage)) return recipe
  const updated = { ...recipe, ingredients: recipe.ingredients.map((item) => item.id === id
    ? { ...item, percentage: Math.max(0, percentage) } : item) }
  return containsFlour(edited) ? rebalanceFreeFlour(updated, id) : updated
}

export function updateSourdoughTa(recipe: Recipe, id: string, ta: number, fixedGrams?: Record<string, number>): Recipe {
  const edited = recipe.ingredients.find((item) => item.id === id)
  if (edited?.kind !== 'sourdough' || edited.locked || !Number.isFinite(ta)) return recipe
  const updated = {
    ...recipe,
    ingredients: recipe.ingredients.map((item) => item.id === id ? { ...item, sourdoughTa: Math.max(100, ta) } : item),
  }
  return fixedGrams ? percentagesFromIngredientGrams(updated, fixedGrams) : rebalanceFreeFlour(updated, id)
}

export function removeRecipeIngredient(recipe: Recipe, id: string, fixedGrams?: Record<string, number>): Recipe {
  if (!canRemoveRecipeIngredient(recipe, id)) return recipe
  const removed = recipe.ingredients.find((item) => item.id === id)!
  const remaining = { ...recipe, ingredients: recipe.ingredients.filter((item) => item.id !== id) }
  if (fixedGrams) return percentagesFromIngredientGrams(remaining, fixedGrams)
  return containsFlour(removed) ? rebalanceFreeFlour(remaining) : remaining
}

export function calculateRecipe(recipe: Recipe, doughWeight: number): RecipeCalculations {
  const flourPercentage = totalFlourPercentage(recipe)
  const sourdoughFlour = recipe.ingredients
    .filter((item) => item.kind === 'sourdough')
    .reduce((sum, item) => sum + item.percentage / ingredientFactor(item), 0)
  const sourdoughWater = recipe.ingredients
    .filter((item) => item.kind === 'sourdough')
    .reduce((sum, item) => sum + item.percentage * (1 - 1 / ingredientFactor(item)), 0)
  const liquidWater = recipe.ingredients
    .filter((item) => item.kind === 'liquid' || item.kind === 'other')
    .reduce((sum, item) => sum + item.percentage * ((item.waterContent || 0) / 100), 0)
  const totalWater = sourdoughWater + liquidWater
  const totalPercentage = recipe.ingredients.reduce((sum, item) => sum + item.percentage, 0)
  const gramsPerPercent = doughWeight / (totalPercentage || 100)
  const ingredientGrams: Record<string, number> = {}

  for (const item of recipe.ingredients) {
    ingredientGrams[item.id] = round(item.percentage * gramsPerPercent)
  }

  const totalFlourGrams = recipe.ingredients.reduce((sum, item) => {
    if (item.kind === 'flour') return sum + ingredientGrams[item.id]
    if (item.kind === 'sourdough') return sum + ingredientGrams[item.id] / ingredientFactor(item)
    return sum
  }, 0)
  const hydration = flourPercentage ? totalWater / flourPercentage * 100 : 0

  return {
    hydration: round(hydration),
    ta: round(100 + hydration),
    sourdough: flourPercentage ? round(sourdoughFlour / flourPercentage * 100) : 0,
    totalFlourGrams: round(totalFlourGrams),
    ingredientGrams,
  }
}

export function calculateRecipeFromIngredientGrams(recipe: Recipe, gramsById: Record<string, number>): RecipeCalculations {
  const ingredientGrams = Object.fromEntries(recipe.ingredients.map((item) => [item.id, round(gramsById[item.id] || 0)]))
  const totalFlourGrams = recipe.ingredients.reduce((sum, item) => {
    if (item.kind === 'flour') return sum + ingredientGrams[item.id]
    if (item.kind === 'sourdough') return sum + ingredientGrams[item.id] / ingredientFactor(item)
    return sum
  }, 0)
  const sourdoughFlourGrams = recipe.ingredients
    .filter((item) => item.kind === 'sourdough')
    .reduce((sum, item) => sum + ingredientGrams[item.id] / ingredientFactor(item), 0)
  const waterGrams = recipe.ingredients.reduce((sum, item) => {
    if (item.kind === 'sourdough') return sum + ingredientGrams[item.id] * (1 - 1 / ingredientFactor(item))
    if (item.kind === 'liquid' || item.kind === 'other') return sum + ingredientGrams[item.id] * ((item.waterContent || 0) / 100)
    return sum
  }, 0)
  const hydration = totalFlourGrams ? waterGrams / totalFlourGrams * 100 : 0
  return {
    hydration: round(hydration),
    ta: round(100 + hydration),
    sourdough: totalFlourGrams ? round(sourdoughFlourGrams / totalFlourGrams * 100) : 0,
    totalFlourGrams: round(totalFlourGrams),
    ingredientGrams,
  }
}

export function percentageForIngredientGrams(recipe: Recipe, doughWeight: number, id: string, grams: number) {
  const item = recipe.ingredients.find((candidate) => candidate.id === id)
  if (!item) return 0
  const targetGrams = Math.max(0, Math.min(grams, doughWeight))
  const otherCoefficient = recipe.ingredients
    .filter((candidate) => candidate.id !== id)
    .reduce((sum, candidate) => sum + candidate.percentage, 0)
  if (otherCoefficient <= 0 || targetGrams >= doughWeight) return item.percentage
  const flourBase = (doughWeight - targetGrams) / otherCoefficient
  return round(targetGrams / flourBase)
}

export function percentagesFromIngredientGrams(recipe: Recipe, gramsById: Record<string, number>) {
  const flourGrams = recipe.ingredients.reduce((sum, item) => {
    const grams = gramsById[item.id] || 0
    if (item.kind === 'flour') return sum + grams
    if (item.kind === 'sourdough') return sum + grams / ingredientFactor(item)
    return sum
  }, 0)
  if (flourGrams <= 0) return recipe
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((item) => ({
      ...item,
      percentage: round((gramsById[item.id] || 0) / flourGrams * 100),
    })),
  }
}

export function convertYeastPercentage(percentage: number, from: 'fresh' | 'dry', to: 'fresh' | 'dry') {
  if (from === to) return percentage
  return round(from === 'fresh' ? percentage / 3 : percentage * 3)
}
