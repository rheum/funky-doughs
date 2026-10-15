import { describe, expect, it } from 'vitest'
import { calculateRecipe, calculateRecipeFromIngredientGrams, convertYeastPercentage, percentageForIngredientGrams, percentagesFromIngredientGrams, updateIngredientPercentage, totalFlourPercentage, migrateSourdoughPercentages, removeRecipeIngredient, updateSourdoughTa, setIngredientLocked, canRemoveRecipeIngredient } from './calculations'
import type { Recipe } from './types'

const recipe = (ingredients: Recipe['ingredients']): Recipe => ({ id: 'test', title: 'Test', ingredients, updatedAt: '' })
const flour = (percentage: number) => ({ id: 'flour', kind: 'flour' as const, name: 'Weizen 550', percentage })
const water = (percentage: number) => ({ id: 'water', kind: 'liquid' as const, name: 'Wasser', percentage, liquidKind: 'water' as const, waterContent: 100 })

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

  it('erlaubt Sauerteiganteile über 100 Prozent mit passendem Mehlausgleich', () => {
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


describe('Fixierte Zutaten und automatischer Ausgleich', () => {
  const input = () => recipe([
    flour(60),
    { ...flour(20), id: 'rye' },
    { id: 'starter', kind: 'sourdough', name: 'Sauerteig', percentage: 36, sourdoughTa: 180 },
    water(60),
  ])

  it('verteilt nur auf freie Mehlzutaten', () => {
    const original = setIngredientLocked(input(), 'rye', true)
    const updated = updateIngredientPercentage(original, 'flour', 40)
    expect(updated.ingredients.map(i => i.percentage)).toEqual([40, 20, 72, 60])
    expect(totalFlourPercentage(updated)).toBeCloseTo(100)
    expect(original.ingredients[2].percentage).toBe(36)
  })

  it('verteilt ohne Fixierungen gleichmäßig nach Mehlanteil', () => {
    expect(updateIngredientPercentage(input(), 'flour', 40).ingredients.map(i => i.percentage)).toEqual([40, 30, 54, 60])
  })

  it('verhindert das Fixieren der letzten freien Mehlzutat', () => {
    const locked = setIngredientLocked(setIngredientLocked(input(), 'flour', true), 'rye', true)
    expect(setIngredientLocked(locked, 'starter', true)).toEqual(locked)
    expect(setIngredientLocked(locked, 'water', true).ingredients[3].locked).toBe(true)
    expect(setIngredientLocked(locked, 'flour', false).ingredients[0].locked).toBe(false)
  })

  it('lässt fixierte Eingaben und TA unverändert', () => {
    const locked = setIngredientLocked(input(), 'starter', true)
    expect(updateIngredientPercentage(locked, 'starter', 80)).toEqual(locked)
    expect(updateSourdoughTa(locked, 'starter', 250)).toEqual(locked)
    expect(removeRecipeIngredient(locked, 'starter')).toEqual(locked)
  })

  it('setzt den einzigen freien Mehlanteil auf den verbleibenden Rest', () => {
    const locked = setIngredientLocked(setIngredientLocked(input(), 'flour', true), 'rye', true)
    const updated = updateIngredientPercentage(locked, 'starter', 80)
    expect(updated.ingredients.map(i => i.percentage)).toEqual([60, 20, 36, 60])
    expect(totalFlourPercentage(updated)).toBeCloseTo(100)
  })

  it('begrenzt Erhöhungen auf den Anteil, der nach Fixierungen noch verfügbar ist', () => {
    const locked = setIngredientLocked(input(), 'starter', true)
    const updated = updateIngredientPercentage(locked, 'flour', 95)
    expect(updated.ingredients.map(i => i.percentage)).toEqual([80, 0, 36, 60])
  })

  it('verteilt nach Erreichen von null weiter, ohne fixierte Anteile zu ändern', () => {
    const original = input()
    original.ingredients[0].percentage = 50
    original.ingredients[1].percentage = 5
    original.ingredients[2].percentage = 81
    expect(updateIngredientPercentage(original, 'flour', 80).ingredients.map(i => i.percentage)).toEqual([80, 0, 36, 60])
  })

  it.each([150, 180, 200, 250])('berücksichtigt TA %s bei freien Sauerteigen', (ta) => {
    const original = input()
    original.ingredients[2].sourdoughTa = ta
    original.ingredients[2].percentage = ta / 5
    const updated = updateIngredientPercentage(setIngredientLocked(original, 'rye', true), 'flour', 40)
    expect(updated.ingredients[2].percentage).toBe(ta * 0.4)
    expect(totalFlourPercentage(updated)).toBeCloseTo(100)
  })

  it('gleicht TA-Änderungen nur über freie Zutaten aus', () => {
    const updated = updateSourdoughTa(setIngredientLocked(input(), 'rye', true), 'starter', 360)
    expect(updated.ingredients.map(i => i.percentage)).toEqual([70, 20, 36, 60])
    expect(totalFlourPercentage(updated)).toBeCloseTo(100)
  })

  it('verteilt beim Entfernen nur auf freie Zutaten', () => {
    const updated = removeRecipeIngredient(setIngredientLocked(input(), 'rye', true), 'flour')
    expect(updated.ingredients.map(i => i.percentage)).toEqual([20, 144, 60])
  })

  it('verhindert das Entfernen der letzten freien Mehlzutat', () => {
    const locked = setIngredientLocked(setIngredientLocked(input(), 'flour', true), 'rye', true)
    expect(canRemoveRecipeIngredient(locked, 'starter')).toBe(false)
    expect(removeRecipeIngredient(locked, 'starter')).toEqual(locked)
    expect(canRemoveRecipeIngredient(input(), 'flour')).toBe(true)
    expect(canRemoveRecipeIngredient(recipe([flour(100)]), 'flour')).toBe(false)
  })

  it('erhält fixe Grammwerte bei Änderungen anderer Mengen', () => {
    const locked = setIngredientLocked(input(), 'starter', true)
    const result = percentagesFromIngredientGrams(locked, { flour: 500, rye: 200, starter: 360, water: 600 })
    expect(result.ingredients[2].locked).toBe(true)
    expect(calculateRecipeFromIngredientGrams(result, { flour: 500, rye: 200, starter: 360, water: 600 }).ingredientGrams.starter).toBe(360)
  })

  it('stellt beim Laden vollständig fixierter Rezepte eine freie Mehlzutat sicher', () => {
    const original = input()
    original.sourdoughPercentageBasis = 'total'
    original.ingredients = original.ingredients.map(i => ({ ...i, locked: true }))
    const loaded = migrateSourdoughPercentages(original)
    expect(loaded.ingredients[0].locked).toBe(false)
    expect(loaded.ingredients.slice(1).every(i => i.locked)).toBe(true)
    expect(migrateSourdoughPercentages(loaded)).toEqual(loaded)
  })
})
