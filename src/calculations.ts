import type { Ingredient, Recipe } from './types'

export type RecipeCalculations = {
  hydration: number
  ta: number
  sourdough: number
  totalFlourGrams: number
  ingredientGrams: Record<string, number>
}

const round = (value: number) => Math.round(value * 10) / 10
const ingredientFactor = (item: Ingredient) => item.kind === 'sourdough' ? (item.sourdoughTa || 200) / 100 : 1

export function calculateRecipe(recipe: Recipe, doughWeight: number): RecipeCalculations {
  const flourPercentage = recipe.ingredients
    .filter((item) => item.kind === 'flour' || item.kind === 'sourdough')
    .reduce((sum, item) => sum + item.percentage, 0)
  const sourdoughFlour = recipe.ingredients
    .filter((item) => item.kind === 'sourdough')
    .reduce((sum, item) => sum + item.percentage, 0)
  const sourdoughWater = recipe.ingredients
    .filter((item) => item.kind === 'sourdough')
    .reduce((sum, item) => sum + item.percentage * (((item.sourdoughTa || 200) / 100) - 1), 0)
  const liquidWater = recipe.ingredients
    .filter((item) => item.kind === 'liquid' || item.kind === 'other')
    .reduce((sum, item) => sum + item.percentage * ((item.waterContent || 0) / 100), 0)
  const totalWater = sourdoughWater + liquidWater
  const nonFlourPercentage = recipe.ingredients
    .filter((item) => item.kind !== 'flour' && item.kind !== 'sourdough')
    .reduce((sum, item) => sum + item.percentage, 0) + recipe.ingredients
    .filter((item) => item.kind === 'sourdough')
    .reduce((sum, item) => sum + item.percentage * ((item.sourdoughTa || 200) / 100), 0)
  const gramsPerPercent = doughWeight / (flourPercentage + nonFlourPercentage || 100)
  const ingredientGrams: Record<string, number> = {}

  for (const item of recipe.ingredients) {
    ingredientGrams[item.id] = round(item.percentage * ingredientFactor(item) * gramsPerPercent)
  }

  const totalFlourGrams = recipe.ingredients.reduce((sum, item) => {
    if (item.kind === 'flour') return sum + ingredientGrams[item.id]
    if (item.kind === 'sourdough') return sum + ingredientGrams[item.id] / ((item.sourdoughTa || 200) / 100)
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
    .reduce((sum, candidate) => sum + candidate.percentage * ingredientFactor(candidate), 0)
  if (otherCoefficient <= 0 || targetGrams >= doughWeight) return item.percentage
  const flourBase = (doughWeight - targetGrams) / otherCoefficient
  return round(targetGrams / (flourBase * ingredientFactor(item)))
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
      percentage: round(((gramsById[item.id] || 0) / ingredientFactor(item)) / flourGrams * 100),
    })),
  }
}

export function convertYeastPercentage(percentage: number, from: 'fresh' | 'dry', to: 'fresh' | 'dry') {
  if (from === to) return percentage
  return round(from === 'fresh' ? percentage / 3 : percentage * 3)
}
