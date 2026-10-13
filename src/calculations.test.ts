import { describe, expect, it } from 'vitest'
import { calculateRecipe, calculateRecipeFromIngredientGrams, convertYeastPercentage, percentageForIngredientGrams, percentagesFromIngredientGrams } from './calculations'
import type { Recipe } from './types'

const recipe = (ingredients: Recipe['ingredients']): Recipe => ({ id: 'test', title: 'Test', ingredients, updatedAt: '' })
const flour = (percentage: number) => ({ id: 'flour', kind: 'flour' as const, name: 'Weizen 550', percentage })
const water = (percentage: number) => ({ id: 'water', kind: 'liquid' as const, name: 'Wasser', percentage, liquidKind: 'water' as const, waterContent: 100 })

describe('Rezeptberechnungen', () => {
  it('berechnet die Versäuerung als Mehlanteil des Gesamtmehls', () => {
    const result = calculateRecipe(recipe([
      flour(75),
      { id: 'rye-sourdough', kind: 'sourdough', name: 'Roggensauerteig', percentage: 15, grain: 'Roggen', sourdoughTa: 200 },
      { id: 'wheat-sourdough', kind: 'sourdough', name: 'Weizensauerteig', percentage: 10, grain: 'Weizen', sourdoughTa: 180 },
    ]), 1000)

    expect(result.sourdough).toBe(25)
  })

  it('berechnet Sauerteigmehl und Sauerteigwasser aus Versäuerung und TA', () => {
    const result = calculateRecipe(recipe([
      flour(80),
      { id: 'sourdough', kind: 'sourdough', name: 'Roggensauerteig', percentage: 20, grain: 'Roggen', sourdoughTa: 200 },
      water(60),
    ]), 1000)

    expect(result.sourdough).toBe(20)
    expect(result.ta).toBe(180)
    expect(result.totalFlourGrams).toBe(500)
    expect(result.ingredientGrams.sourdough).toBe(200)
  })

  it('bezieht Milch nur mit ihrem Wasseranteil in die Hydration ein', () => {
    const result = calculateRecipe(recipe([
      flour(100),
      { id: 'milk', kind: 'liquid', name: 'Milch', percentage: 50, liquidKind: 'milk', waterContent: 87 },
    ]), 1000)

    expect(result.hydration).toBe(43.5)
    expect(result.ta).toBe(143.5)
  })

  it('rechnet Frischhefe und Trockenhefe im Verhältnis 3 zu 1 um', () => {
    expect(convertYeastPercentage(3, 'fresh', 'dry')).toBe(1)
    expect(convertYeastPercentage(1, 'dry', 'fresh')).toBe(3)
    expect(convertYeastPercentage(2.5, 'fresh', 'fresh')).toBe(2.5)
  })

  it('berechnet alle Grammwerte aus der gewünschten Teigmenge', () => {
    const result = calculateRecipe(recipe([flour(100), water(65)]), 1000)
    expect(result.totalFlourGrams).toBe(606.1)
    expect(result.ingredientGrams.flour).toBe(606.1)
    expect(result.ingredientGrams.water).toBe(393.9)
  })

  it('rechnet einen geänderten Grammwert zurück in Bäckerprozente', () => {
    const input = recipe([flour(100), water(65)])
    const waterPercentage = percentageForIngredientGrams(input, 1000, 'water', 400)
    const result = calculateRecipe(recipe([flour(100), { ...water(0), percentage: waterPercentage }]), 1000)

    expect(waterPercentage).toBe(66.7)
    expect(result.ingredientGrams.water).toBeCloseTo(400, 0)
    expect(result.ingredientGrams.flour).toBeCloseTo(600, 0)
  })

  it('kann Zutatenmengen als feste Grammwerte in Prozente zurückrechnen', () => {
    const input = recipe([flour(100), water(65)])
    const result = percentagesFromIngredientGrams(input, { flour: 600, water: 400 })

    expect(result.ingredients[0].percentage).toBe(100)
    expect(result.ingredients[1].percentage).toBe(66.7)
  })

  it('berechnet KPIs im Modus feste Zutatenmengen direkt aus den Grammwerten', () => {
    const input = recipe([
      flour(85.5),
      { id: 'wheat-sourdough', kind: 'sourdough', name: 'Weizensauerteig', percentage: 7.7, grain: 'Weizen', sourdoughTa: 200 },
      { id: 'rye-sourdough', kind: 'sourdough', name: 'Roggensauerteig', percentage: 6.8, grain: 'Roggen', sourdoughTa: 200 },
    ])
    const result = calculateRecipeFromIngredientGrams(input, { flour: 501, 'wheat-sourdough': 45.1, 'rye-sourdough': 79.5 })

    expect(result.totalFlourGrams).toBe(563.3)
    expect(result.sourdough).toBe(11.1)
  })
})
