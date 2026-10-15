import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Ingredient, IngredientKind, PreparationStep, Recipe } from './types'
import type { RecipeCalculations } from './calculations'

const ingredientGroupOrder: Record<IngredientKind, number> = { flour: 0, sourdough: 1, liquid: 2, salt: 3, yeast: 3, other: 3 }
const sortedIngredients = (ingredients: Ingredient[]) => [...ingredients].sort((a, b) => ingredientGroupOrder[a.kind] - ingredientGroupOrder[b.kind] || b.percentage - a.percentage)


export function createRecipePdf(recipe: Recipe, doughWeight: number, calculations: RecipeCalculations) {
    const doc = new jsPDF({ format: 'a4', unit: 'mm' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const footerY = doc.internal.pageSize.getHeight() - 12
    const contentBottom = footerY - 10
    const accent = '#e87639'
    const ink = '#29251f'
    const muted = '#8d8478'
    const detail = (item: Ingredient) => {
      if (item.kind === 'sourdough') return `${item.grain} · TA ${item.sourdoughTa || 200}`
      if (item.kind === 'liquid') return `${item.name}${item.liquidKind === 'other' ? ` · Wasseranteil ${item.waterContent || 0} %` : ''}`
      return item.name
    }
    doc.setTextColor(ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.text(recipe.title || 'Funky Doughs-Rezept', 18, 22)
    doc.setTextColor(muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Teigmenge ${doughWeight} g`, 18, 29)
    doc.setDrawColor(accent); doc.setLineWidth(1); doc.line(18, 35, pageWidth - 18, 35)
    const kpis = [['Gesamt-TA', `${calculations.ta} %`], ['Versäuertes Mehl', `${calculations.sourdough} %`], ['Gesamtmehlmenge', `${calculations.totalFlourGrams} g`, '(inkl. Sauerteig)']]
    kpis.forEach(([label, value, note], index) => { const x = 18 + index * 58; doc.setFillColor('#f7f1e9'); doc.roundedRect(x, 43, 52, 23, 2, 2, 'F'); doc.setTextColor(muted); doc.setFontSize(7); doc.text(label.toUpperCase(), x + 4, 50); if (note) doc.text(note, x + 4, 54); doc.setTextColor(ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(value, x + 4, 60); doc.setFont('helvetica', 'normal') })
    autoTable(doc, { startY: 76, margin: { left: 18, right: 18, bottom: 22 }, head: [['Zutat', 'Typ / Details', 'Bäcker-%', 'Gramm']], body: sortedIngredients(recipe.ingredients).map((item) => [item.name, detail(item), `${item.percentage} %`, `${calculations.ingredientGrams[item.id] ?? 0} g`]), theme: 'grid', styles: { font: 'helvetica', fontSize: 9, textColor: ink, cellPadding: 3 }, headStyles: { fillColor: '#29251f', textColor: '#ffffff', fontStyle: 'bold' }, alternateRowStyles: { fillColor: '#fbf8f3' }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } } })
    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 76
    let preparationY = finalY + 14
    const ensurePreparationSpace = (height: number) => {
      if (preparationY + height > contentBottom) {
        doc.addPage()
        preparationY = 22
      }
    }
    if (recipe.preparation?.length) {
      ensurePreparationSpace(14)
      doc.setTextColor(ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Zubereitung', 18, preparationY)
      preparationY += 8
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      const writeSteps = (steps: PreparationStep[], prefix: string, indent: number) => {
        steps.forEach((step, index) => {
          const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`
          const lines = doc.splitTextToSize(`${number}  ${step.text}`, pageWidth - 36 - indent)
          for (const line of lines) {
            ensurePreparationSpace(4.5)
            doc.text(line, 18 + indent, preparationY)
            preparationY += 4.5
          }
          preparationY += 1.5
          if (step.children?.length) writeSteps(step.children, number, indent + 6)
        })
      }
      writeSteps(recipe.preparation || [], '', 0)
    }
    const punchMarkY = 148.5
    doc.setDrawColor('#b8afa3')
    doc.setLineWidth(0.35)
    for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
      doc.setPage(page)
      doc.line(4, punchMarkY, 11, punchMarkY)
      doc.setTextColor(muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
      doc.text('Erstellt mit Funky Doughs', 18, footerY)
    }
    doc.setPage(doc.getNumberOfPages())
    return doc
}
