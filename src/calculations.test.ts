import { describe, expect, it } from 'vitest'
import { calculateRecipe, calculateRecipeFromIngredientGrams, convertYeastPercentage, percentageForIngredientGrams, percentagesFromIngredientGrams, updateIngredientPercentage, totalFlourPercentage, migrateSourdoughPercentages, removeRecipeIngredient, updateSourdoughTa } from './calculations'
import type { Recipe } from './types'

const recipe = (ingredients: Recipe['ingredients']): Recipe => ({ id: 'test', title: 'Test', ingredients, updatedAt: '' })
const flour = (percentage: number) => ({ id: 'flour', kind: 'flour' as const, name: 'Weizen 550', percentage })
const water = (percentage: number) => ({ id: 'water', kind: 'liquid' as const, name: 'Wasser', percentage, liquidKind: 'water' as const, waterContent: 100 })

describe('Sauerteig-TA ändern', () => {
  const input = () => recipe([
    flour(60),
    { id: 'starter', kind: 'sourdough', name: 'Sauerteig', percentage: 40, sourdoughTa: 200 },
    { id: 'other-starter', kind: 'sourdough', name: 'Zweiter Sauerteig', percentage: 36, sourdoughTa: 180 },
    water(60),
  ])

  it.each([
    [100, 50, 18],
    [400, 65, 45],
  ])('verteilt nach Änderung auf TA %s die Mehlanteile neu', (ta, flourShare, otherStarterShare) => {
    const original = input()
    const updated = updateSourdoughTa(original, 'starter', ta)
    expect(updated.ingredients.map((item) => item.percentage)).toEqual([flourShare, 40, otherStarterShare, 60])
    expect(updated.ingredients[1].sourdoughTa).toBe(ta)
    expect(totalFlourPercentage(updated)).toBeCloseTo(100)
    const result = calculateRecipe(updated, 1000)
    expect(Object.values(result.ingredientGrams).reduce((sum, grams) => sum + grams, 0)).toBeCloseTo(1000, 0)
    expect(original.ingredients[1].sourdoughTa).toBe(200)
  })

  it('berechnet im Modus feste Mengen die Prozente und KPIs aus unveränderten Grammwerten', () => {
    const original = recipe([flour(80), input().ingredients[1], water(60)])
    const grams = { flour: 800, starter: 400, water: 600 }
    const updated = updateSourdoughTa(original, 'starter', 100, grams)
    expect(updated.ingredients.map((item) => item.percentage)).toEqual([66.7, 33.3, 50])
    const result = calculateRecipeFromIngredientGrams(updated, grams)
    expect(result.ingredientGrams).toEqual(grams)
    expect(result.totalFlourGrams).toBe(1200)
    expect(result.hydration).toBe(50)
  })

  it('begrenzt die TA auf mindestens 100 und ignoriert ungültige Ziele', () => {
    expect(updateSourdoughTa(input(), 'starter', 50).ingredients[1].sourdoughTa).toBe(100)
    const original = input()
    expect(updateSourdoughTa(original, 'flour', 200)).toEqual(original)
    expect(updateSourdoughTa(original, 'missing', 200)).toEqual(original)
    expect(updateSourdoughTa(original, 'starter', NaN)).toEqual(original)
  })
})

describe('Zutaten entfernen', () => {
  const input = () => recipe([
    flour(60),
    { ...flour(20), id: 'rye' },
    { id: 'starter', kind: 'sourdough', name: 'Sauerteig', percentage: 36, sourdoughTa: 180 },
    water(60),
  ])

  it('verteilt das entfernte Mehl gleichmäßig unter Berücksichtigung der Sauerteig-TA', () => {
    const original = input()
    const updated = removeRecipeIngredient(original, 'flour')
    expect(updated.ingredients.map((item) => item.percentage)).toEqual([50, 90, 60])
    expect(totalFlourPercentage(updated)).toBe(100)
    expect(original.ingredients[0].percentage).toBe(60)
  })

  it('verteilt nur den Mehlanteil eines entfernten Sauerteigs', () => {
    const updated = removeRecipeIngredient(input(), 'starter')
    expect(updated.ingredients.map((item) => item.percentage)).toEqual([70, 30, 60])
    expect(totalFlourPercentage(updated)).toBe(100)
  })

  it('lässt andere Zutaten und entfernte Nullanteile ohne Umverteilung', () => {
    const original = input()
    expect(removeRecipeIngredient(original, 'water').ingredients).toEqual(original.ingredients.slice(0, 3))
    const withZero = { ...original, ingredients: [...original.ingredients, { ...flour(0), id: 'new' }] }
    expect(removeRecipeIngredient(withZero, 'new')).toEqual(original)
    expect(removeRecipeIngredient(original, 'missing')).toEqual(original)
  })

  it('setzt den letzten verbleibenden Sauerteig auf 100 Prozent Mehl', () => {
    const original = input()
    const updated = removeRecipeIngredient(removeRecipeIngredient(original, 'flour'), 'rye')
    expect(updated.ingredients[0].percentage).toBe(180)
    expect(totalFlourPercentage(updated)).toBe(100)
    expect(removeRecipeIngredient(updated, 'starter').ingredients).toEqual([water(60)])
  })

  it('berechnet beim Entfernen mit festen Mengen nur die Prozente und KPIs neu', () => {
    const original = input()
    const grams = { flour: 600, rye: 200, starter: 360, water: 600 }
    const updated = removeRecipeIngredient(original, 'flour', grams)
    expect(updated.ingredients.map((item) => item.percentage)).toEqual([50, 90, 150])
    const result = calculateRecipeFromIngredientGrams(updated, grams)
    expect(result.ingredientGrams).toEqual({ rye: 200, starter: 360, water: 600 })
    expect(result.totalFlourGrams).toBe(400)
  })
})

describe('Rezeptberechnungen', () => {
  it('berechnet die Versäuerung als Mehlanteil des Gesamtmehls', () => {
    const result = calculateRecipe(recipe([
      flour(75),
      { id: 'rye-sourdough', kind: 'sourdough', name: 'Roggensauerteig', percentage: 30, grain: 'Roggen', sourdoughTa: 200 },
      { id: 'wheat-sourdough', kind: 'sourdough', name: 'Weizensauerteig', percentage: 18, grain: 'Weizen', sourdoughTa: 180 },
    ]), 1000)

    expect(result.sourdough).toBe(25)
  })

  it('berechnet Sauerteigmehl und Sauerteigwasser aus Sauerteiganteil und TA', () => {
    const result = calculateRecipe(recipe([
      flour(80),
      { id: 'sourdough', kind: 'sourdough', name: 'Roggensauerteig', percentage: 40, grain: 'Roggen', sourdoughTa: 200 },
      water(60),
    ]), 1000)

    expect(result.sourdough).toBe(20)
    expect(result.ta).toBe(180)
    expect(result.totalFlourGrams).toBeCloseTo(555.6, 0)
    expect(result.ingredientGrams.sourdough).toBe(222.2)
    expect(Object.values(result.ingredientGrams).reduce((sum, grams) => sum + grams, 0)).toBeCloseTo(1000, 0)
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

describe('Mehlanteile verteilen', () => {
  const mixed = () => recipe([
    flour(60),
    { ...flour(20), id: 'rye' },
    { id: 'starter', kind: 'sourdough', name: 'Sauerteig', percentage: 40, sourdoughTa: 200 },
    water(60),
    { id: 'salt', kind: 'salt', name: 'Salz', percentage: 2 },
  ])
  const shares = (input: Recipe) => input.ingredients.filter((item) => item.kind === 'flour' || item.kind === 'sourdough').map((item) => item.percentage)

  it('verteilt frei werdendes Mehl gleichmäßig auf andere Mehle und Sauerteige', () => {
    const input = mixed()
    const result = updateIngredientPercentage(input, 'flour', 40)
    expect(shares(result)).toEqual([40, 30, 60])
    expect(result.ingredients.slice(3)).toEqual(input.ingredients.slice(3))
    expect(shares(input)).toEqual([60, 20, 40])
  })

  it('zieht bei einer Erhöhung gleiche Anteile von den anderen Mehlen ab', () => {
    expect(shares(updateIngredientPercentage(mixed(), 'flour', 80))).toEqual([80, 10, 20])
  })

  it('verteilt weiter, wenn ein kleiner Mehlanteil bei null ankommt', () => {
    const input = mixed()
    input.ingredients[0].percentage = 50
    input.ingredients[1].percentage = 5
    input.ingredients[2].percentage = 90
    expect(shares(updateIngredientPercentage(input, 'flour', 80))).toEqual([80, 0, 40])
  })

  it('hält auch bei Rundungsresten die Summe auf 100 Prozent', () => {
    const input = mixed()
    input.ingredients.splice(3, 0, { ...flour(0), id: 'spelt' })
    const result = shares(updateIngredientPercentage(input, 'flour', 59))
    expect(result[0]).toBe(59)
    expect(totalFlourPercentage(updateIngredientPercentage(input, 'flour', 59))).toBeCloseTo(100, 5)
    const increments = result.slice(1).map((value, index) => value / [1, 2, 1][index] - [20, 20, 0][index])
    expect(Math.max(...increments) - Math.min(...increments)).toBeLessThanOrEqual(0.1)
  })

  it('begrenzt Eingaben und hält ein einzelnes Mehl bei 100 Prozent', () => {
    expect(shares(updateIngredientPercentage(mixed(), 'flour', 120))).toEqual([100, 0, 0])
    expect(shares(updateIngredientPercentage(mixed(), 'flour', -10))).toEqual([0, 50, 100])
    expect(shares(updateIngredientPercentage(recipe([flour(100), water(60)]), 'flour', 50))).toEqual([100])
  })

  it('ändert Wasserprozente ohne Umverteilung der Mehle', () => {
    const result = updateIngredientPercentage(mixed(), 'water', 70)
    expect(shares(result)).toEqual([60, 20, 40])
    expect(result.ingredients[3].percentage).toBe(70)
  })

  it.each([150, 180, 200, 250])('berücksichtigt TA %s bei Sauerteigmenge und Rückrechnung', (ta) => {
    const input = mixed()
    input.ingredients[2].sourdoughTa = ta
    input.ingredients[2].percentage = 20 * ta / 100
    const updated = updateIngredientPercentage(input, 'flour', 40)
    const calculated = calculateRecipe(updated, 1000)
    const flourGrams = calculated.ingredientGrams.flour + calculated.ingredientGrams.rye + calculated.ingredientGrams.starter / (ta / 100)
    expect(calculated.sourdough).toBe(30)
    expect(calculated.ingredientGrams.starter / (ta / 100) / flourGrams * 100).toBeCloseTo(30, 1)
    expect(Object.values(calculated.ingredientGrams).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1000, 0)
    expect(shares(percentagesFromIngredientGrams(updated, calculated.ingredientGrams))).toEqual([40, 30, 30 * ta / 100])
    expect(shares(updateIngredientPercentage(updated, 'starter', 20 * ta / 100))).toEqual([45, 35, 20 * ta / 100])
  })

  it('verteilt gleiche Mehlanteile auf mehrere Sauerteige mit unterschiedlicher TA', () => {
    const input = recipe([
      flour(60),
      { id: 'firm', kind: 'sourdough', name: 'Fester Sauerteig', percentage: 30, sourdoughTa: 150 },
      { id: 'liquid', kind: 'sourdough', name: 'Flüssiger Sauerteig', percentage: 50, sourdoughTa: 250 },
      water(40),
    ])
    const updated = updateIngredientPercentage(input, 'flour', 40)
    const result = calculateRecipe(updated, 1000)
    expect(shares(updated)).toEqual([40, 45, 75])
    expect(result.ingredientGrams.firm).toBe(225)
    expect(result.ingredientGrams.liquid).toBe(375)
    expect(result.hydration).toBe(100)
    expect(result.sourdough).toBe(60)
    expect(Object.values(result.ingredientGrams).reduce((sum, grams) => sum + grams, 0)).toBeCloseTo(1000, 0)
  })
})


describe('Sauerteigprozente als gesamte Sauerteigmenge', () => {
  const input = recipe([
    flour(90),
    { id: 'starter', kind: 'sourdough', name: 'Sauerteig', percentage: 20, sourdoughTa: 200 },
    water(60),
  ])

  it('berechnet bei 20 % Sauerteig und TA 200 nur 10 % versäuertes Mehl', () => {
    const result = calculateRecipe(input, 1700)
    expect(result.ingredientGrams).toEqual({ flour: 900, starter: 200, water: 600 })
    expect(result.totalFlourGrams).toBe(1000)
    expect(result.sourdough).toBe(10)
    expect(result.hydration).toBe(70)
  })

  it('prüft die Mehlsumme mit dem Mehlanteil statt dem ganzen Sauerteig', () => {
    expect(totalFlourPercentage(input)).toBe(100)
    expect(totalFlourPercentage(recipe([{ ...flour(80) }, input.ingredients[1]]))).toBe(90)
    expect(totalFlourPercentage(recipe([{ ...flour(100) }, input.ingredients[1]]))).toBe(110)
  })

  it('rechnet Grammwerte in den gesamten Sauerteiganteil zurück', () => {
    const updated = percentagesFromIngredientGrams(input, { flour: 900, starter: 200, water: 600 })
    expect(updated.ingredients.map((item) => item.percentage)).toEqual([90, 20, 60])
    expect(percentageForIngredientGrams(input, 1700, 'starter', 200)).toBe(20)
  })

  it('erlaubt mehr als 100 % Sauerteig, solange dessen Mehlanteil passt', () => {
    const updated = updateIngredientPercentage(input, 'starter', 150)
    expect(updated.ingredients.map((item) => item.percentage)).toEqual([25, 150, 60])
    expect(totalFlourPercentage(updated)).toBe(100)
    expect(updateIngredientPercentage(recipe([input.ingredients[1]]), 'starter', 50).ingredients[0].percentage).toBe(200)
  })

  it.each([150, 180, 200, 250])('migriert gespeicherte Mehlprozente bei TA %s genau einmal', (ta) => {
    const legacy = recipe([flour(80), { ...input.ingredients[1], percentage: 20, sourdoughTa: ta }])
    const migrated = migrateSourdoughPercentages(legacy)
    expect(migrated.ingredients.map((item) => item.percentage)).toEqual([80, 20 * ta / 100])
    expect(migrateSourdoughPercentages(migrated)).toEqual(migrated)
    expect(legacy.ingredients[1].percentage).toBe(20)
    const calculated = calculateRecipe(migrated, 800 + 2 * ta)
    expect(calculated.ingredientGrams.flour).toBe(800)
    expect(calculated.ingredientGrams.starter).toBe(2 * ta)
  })
})
