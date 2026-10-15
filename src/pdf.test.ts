import { describe, expect, it } from 'vitest'
import { createRecipePdf } from './pdf'
import { calculateRecipe } from './calculations'
import type { Recipe } from './types'

const recipe: Recipe = {
  id: 'pdf-test', title: 'Testbrot', updatedAt: '',
  ingredients: [{ id: 'flour', kind: 'flour', name: 'Weizen 550', percentage: 100 }],
  preparation: [{ id: 'step', text: 'Teig mischen und ruhen lassen.', children: [] }],
}

function textBlocks(pdf: ReturnType<typeof createRecipePdf>) {
  return [...pdf.output().matchAll(/BT\n([\s\S]*?)ET/g)].map((match) => {
    const [, x, y] = match[1].match(/([\d.]+) ([\d.]+) Td/) || []
    return { text: match[1], x: Number(x), y: Number(y) / pdf.internal.scaleFactor }
  })
}

describe('PDF layout', () => {
  it('keeps the footer below the preparation heading', () => {
    const pdf = createRecipePdf(recipe, 1000, calculateRecipe(recipe, 1000))
    const blocks = textBlocks(pdf)
    const heading = blocks.find((block) => block.text.includes('(Zubereitung)'))!
    const footer = blocks.find((block) => block.text.includes('(Erstellt mit Funky Doughs)'))!
    expect(heading.y - footer.y).toBeGreaterThan(10)
    expect(footer.y).toBeCloseTo(12)
    expect(footer.text).toContain('/F1 8 Tf')
  })

  it.each(['many steps', 'one long step', 'many ingredients', 'no steps'])('reserves the footer on every page: %s', (scenario) => {
    const longRecipe = {
      ...recipe,
      ingredients: scenario === 'many ingredients'
        ? Array.from({ length: 60 }, (_, index) => ({ ...recipe.ingredients[0], id: `flour-${index}` }))
        : recipe.ingredients,
      preparation: scenario === 'no steps' ? [] : scenario === 'one long step'
        ? [{ id: 'long', text: 'Lange kneten und ruhen lassen. '.repeat(1000), children: [] }]
        : Array.from({ length: 100 }, (_, index) => ({ id: String(index), text: `Arbeitsschritt ${index + 1}`, children: [] })),
    }
    const pdf = createRecipePdf(longRecipe, 1000, calculateRecipe(longRecipe, 1000))
    if (scenario !== 'no steps') expect(pdf.getNumberOfPages()).toBeGreaterThan(1)
    const blocks = textBlocks(pdf)
    const footers = blocks.filter((block) => block.text.includes('(Erstellt mit Funky Doughs)'))
    expect(footers).toHaveLength(pdf.getNumberOfPages())
    expect(footers.every((footer) => Math.abs(footer.y - 12) < 0.01)).toBe(true)
    const content = blocks.filter((block) => !footers.includes(block))
    expect(content.every((block) => block.y >= 22)).toBe(true)
    expect(content.every((block) => block.y <= pdf.internal.pageSize.getHeight() - 18)).toBe(true)
  })
})
