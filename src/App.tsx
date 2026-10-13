import { useEffect, useMemo, useRef, useState } from 'react'
import yaml from 'js-yaml'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { blankRecipe, flourTypes, grains, uid } from './types'
import type { Grain, Ingredient, IngredientKind, LiquidKind, Recipe, YeastKind } from './types'
import { deleteRecipe, loadRecipes, saveRecipe } from './db'
import { calculateRecipe, calculateRecipeFromIngredientGrams, convertYeastPercentage, percentageForIngredientGrams, percentagesFromIngredientGrams } from './calculations'

const round = (n: number) => Math.round(n * 10) / 10
const num = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0
const ingredientGroupOrder: Record<IngredientKind, number> = { flour: 0, sourdough: 1, liquid: 2, salt: 3, yeast: 3, other: 3 }
const sortedIngredients = (ingredients: Ingredient[]) => [...ingredients].sort((a, b) => ingredientGroupOrder[a.kind] - ingredientGroupOrder[b.kind] || b.percentage - a.percentage)

function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipe, setRecipe] = useState<Recipe>(blankRecipe)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState('')
  const [doughWeight, setDoughWeight] = useState(1000)
  const [calculationMode, setCalculationMode] = useState<'dough' | 'ingredients'>('dough')
  const [fixedIngredientGrams, setFixedIngredientGrams] = useState<Record<string, number> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { loadRecipes().then((saved) => { setRecipes(saved); if (saved[0]) setRecipe(saved[0]); setReady(true) }) }, [])
  useEffect(() => { if (ready) { const timer = window.setTimeout(() => saveRecipe(recipe), 350); return () => window.clearTimeout(timer) } }, [recipe, ready])

  const updateRecipe = (change: (current: Recipe) => Recipe) => setRecipe((current) => ({ ...change(current), updatedAt: new Date().toISOString() }))
  const updateTitle = (title: string) => {
    const updatedAt = new Date().toISOString()
    setRecipe((current) => ({ ...current, title, updatedAt }))
    setRecipes((all) => all.map((item) => item.id === recipe.id ? { ...item, title, updatedAt } : item))
  }
  const selectRecipe = (selected: Recipe) => setRecipe(selected)
  const createRecipe = () => { const fresh = blankRecipe(); setRecipe(fresh); setRecipes((all) => [fresh, ...all.filter((item) => item.id !== fresh.id)]) }

  const removeCurrent = async () => {
    if (!window.confirm(`„${recipe.title}“ wirklich löschen?`)) return
    await deleteRecipe(recipe.id)
    const remaining = recipes.filter((item) => item.id !== recipe.id)
    setRecipes(remaining)
    setRecipe(remaining[0] ?? blankRecipe())
    setNotice('Rezept gelöscht')
  }

  const exportYaml = async () => {
    const all = await loadRecipes()
    const blob = new Blob([yaml.dump({ version: 1, exportedAt: new Date().toISOString(), recipes: all })], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'funky-doughs-rezepte.yaml'; anchor.click(); URL.revokeObjectURL(url)
    setNotice(`${all.length} Rezept${all.length === 1 ? '' : 'e'} exportiert`)
  }

  const exportPdf = () => {
    const doc = new jsPDF({ format: 'a4', unit: 'mm' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const accent = '#e87639'
    const ink = '#29251f'
    const muted = '#8d8478'
    const detail = (item: Ingredient) => {
      if (item.kind === 'sourdough') return `${item.grain} · TA ${item.sourdoughTa || 200}`
      if (item.kind === 'liquid') return `${item.name}${item.liquidKind === 'other' ? ` · Wasseranteil ${item.waterContent || 0} %` : ''}`
      return item.name
    }
    const slug = (recipe.title || 'funky-doughs-rezept').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '')
    doc.setTextColor(ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.text(recipe.title || 'Funky Doughs-Rezept', 18, 22)
    doc.setTextColor(muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Teigmenge ${doughWeight} g · Bäckerprozente inklusive Sauerteigmehl`, 18, 29)
    doc.setDrawColor(accent); doc.setLineWidth(1); doc.line(18, 35, pageWidth - 18, 35)
    const kpis = [['Gesamt-TA', `${calculations.ta} %`], ['Versäuertes Mehl', `${calculations.sourdough} %`], ['Gesamtmehlmenge', `${calculations.totalFlourGrams} g`]]
    kpis.forEach(([label, value], index) => { const x = 18 + index * 58; doc.setFillColor('#f7f1e9'); doc.roundedRect(x, 43, 52, 23, 2, 2, 'F'); doc.setTextColor(muted); doc.setFontSize(7); doc.text(label.toUpperCase(), x + 4, 50); doc.setTextColor(ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(value, x + 4, 60); doc.setFont('helvetica', 'normal') })
    autoTable(doc, { startY: 76, margin: { left: 18, right: 18 }, head: [['Zutat', 'Typ / Details', 'Bäcker-%', 'Gramm']], body: sortedIngredients(recipe.ingredients).map((item) => [item.name, detail(item), `${item.percentage} %`, `${calculations.ingredientGrams[item.id] ?? 0} g`]), theme: 'grid', styles: { font: 'helvetica', fontSize: 9, textColor: ink, cellPadding: 3 }, headStyles: { fillColor: '#29251f', textColor: '#ffffff', fontStyle: 'bold' }, alternateRowStyles: { fillColor: '#fbf8f3' }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } } })
    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 76
    doc.setTextColor(muted); doc.setFontSize(8); doc.text('Erstellt mit Funky Doughs', 18, Math.min(finalY + 14, 285))
    doc.save(`${slug || 'funky-doughs-rezept'}.pdf`)
    setNotice('PDF exportiert')
  }

  const importYaml = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return
    try {
      const parsed = yaml.load(await file.text()) as { recipes?: Recipe[] }
      if (!Array.isArray(parsed?.recipes)) throw new Error('Ungültiges Format')
      for (const item of parsed.recipes) await saveRecipe(item)
      const all = await loadRecipes(); setRecipes(all); if (all[0]) setRecipe(all[0]); setNotice(`${parsed.recipes.length} Rezept${parsed.recipes.length === 1 ? '' : 'e'} importiert`)
    } catch { setNotice('Import fehlgeschlagen — bitte eine Funky-Doughs-YAML-Datei wählen') }
    event.target.value = ''
  }

  const addIngredient = (kind: IngredientKind) => {
    const base: Ingredient = { id: uid(), kind, name: kind === 'flour' ? 'Weizen 550' : kind === 'liquid' ? 'Wasser' : kind === 'sourdough' ? 'Roggensauerteig' : kind === 'salt' ? 'Salz' : kind === 'yeast' ? 'Frischhefe' : 'Neue Zutat', percentage: kind === 'flour' ? 0 : kind === 'liquid' ? 65 : kind === 'salt' ? 2 : kind === 'yeast' ? 2 : 0 }
    if (kind === 'flour') Object.assign(base, { grain: 'Weizen' as Grain, type: '550' })
    if (kind === 'liquid') Object.assign(base, { liquidKind: 'water' as LiquidKind, waterContent: 100 })
    if (kind === 'sourdough') Object.assign(base, { grain: 'Roggen' as Grain, sourdoughTa: 200 })
    if (kind === 'yeast') Object.assign(base, { yeastKind: 'fresh' as YeastKind })
    if (kind === 'other') Object.assign(base, { waterContent: 0 })
    updateRecipe((current) => ({ ...current, ingredients: [...current.ingredients, base] }))
  }
  const updateIngredient = (id: string, patch: Partial<Ingredient>) => updateRecipe((current) => ({ ...current, ingredients: current.ingredients.map((item) => item.id === id ? { ...item, ...patch } : item) }))
  const updateIngredientGrams = (id: string, grams: number) => {
    if (calculationMode === 'dough') {
      updateRecipe((current) => ({ ...current, ingredients: current.ingredients.map((item) => item.id === id ? { ...item, percentage: percentageForIngredientGrams(current, doughWeight, id, grams) } : item) }))
      return
    }
    const currentGrams = recipe.ingredients.reduce<Record<string, number>>((gramsById, item) => {
      gramsById[item.id] = fixedIngredientGrams?.[item.id] ?? calculations.ingredientGrams[item.id] ?? 0
      return gramsById
    }, {})
    const nextGrams = { ...currentGrams, [id]: Math.max(0, grams) }
    const nextRecipe = percentagesFromIngredientGrams(recipe, nextGrams)
    setFixedIngredientGrams(nextGrams)
    setDoughWeight(round(Object.values(nextGrams).reduce((sum, value) => sum + value, 0)))
    updateRecipe(() => nextRecipe)
  }
  const changeCalculationMode = (mode: 'dough' | 'ingredients') => {
    if (mode === 'ingredients') setFixedIngredientGrams({ ...calculations.ingredientGrams })
    else setFixedIngredientGrams(null)
    setCalculationMode(mode)
  }
  const removeIngredient = (id: string) => updateRecipe((current) => ({ ...current, ingredients: current.ingredients.filter((item) => item.id !== id) }))

  const calculations = useMemo(() => calculationMode === 'ingredients' && fixedIngredientGrams
    ? calculateRecipeFromIngredientGrams(recipe, fixedIngredientGrams)
    : calculateRecipe(recipe, doughWeight), [recipe, doughWeight, calculationMode, fixedIngredientGrams])

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">✦</span><div><strong>Funky Doughs</strong><small>rezeptstudio</small></div></div>
      <button className="new-button" onClick={createRecipe}><span>＋</span> Neues Rezept</button>
      <div className="sidebar-label">Meine Rezepte <span>{recipes.length}</span></div>
      <div className="recipe-list">{recipes.map((item) => <button className={`recipe-link ${item.id === recipe.id ? 'active' : ''}`} key={item.id} onClick={() => selectRecipe(item)}><span className="recipe-dot" /><span>{item.id === recipe.id ? (recipe.title || 'Ohne Titel') : (item.title || 'Ohne Titel')}</span></button>)}{recipes.length === 0 && <p className="empty-list">Deine Rezepte werden hier gespeichert.</p>}</div>
      <div className="sidebar-bottom"><button className="text-button" onClick={exportYaml}>↥ <span>Alle exportieren</span></button><button className="text-button" onClick={() => fileInput.current?.click()}>↧ <span>YAML importieren</span></button><input ref={fileInput} type="file" accept=".yaml,.yml" hidden onChange={importYaml} /></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">REZEPTSTUDIO</span><h1>Dein Teig, deine Regeln.</h1></div><div className="save-state"><span className="save-dot" /> Lokal gespeichert</div></header>
      <section className="editor-header"><label className="title-field"><span>Rezepttitel <em>bearbeiten</em></span><input className="title-input" value={recipe.title} onChange={(event) => updateTitle(event.target.value)} aria-label="Rezepttitel" /></label><div className="recipe-meta"><p>Bäckerprozente beziehen sich auf die Gesamtmehlmenge, inklusive Mehl aus Sauerteigen.</p><div className="calculation-controls"><label>Berechnung</label><div className="mode-switch"><button className={calculationMode === 'dough' ? 'active' : ''} onClick={() => changeCalculationMode('dough')}>Teigmenge fest</button><button className={calculationMode === 'ingredients' ? 'active' : ''} onClick={() => changeCalculationMode('ingredients')}>Zutatenmengen fest</button></div><label>Teigmenge <input type="number" min="1" step="10" value={doughWeight} disabled={calculationMode === 'ingredients'} onChange={(event) => setDoughWeight(Math.max(1, num(event.target.value)))} /> <span>g</span></label><button className="pdf-button" onClick={exportPdf}>⇩ PDF exportieren</button></div></div></section>
      <section className="kpi-grid"><Kpi label="Gesamt-TA" value={`${calculations.ta} %`} detail="Mehl + Wasser" accent="orange" /><Kpi label="Versäuertes Mehl" value={`${calculations.sourdough} %`} detail="Anteil an Gesamtmehl" accent="green" /><Kpi label="Gesamtmehlmenge" value={`${calculations.totalFlourGrams} g`} detail="inkl. Sauerteigmehl" accent="purple" /></section>
      <section className="ingredients-section"><div className="section-heading"><div><span className="eyebrow">ZUTATEN</span><h2>Deine Zutaten</h2></div><span className="ingredient-count">{recipe.ingredients.length} Einträge</span></div>
        <div className="ingredient-table"><div className="table-head"><span>Zutat</span><span>Typ / Details</span><span>Bäcker-%</span><span>Gramm</span><span /></div>
          {sortedIngredients(recipe.ingredients).map((item) => <IngredientRow key={item.id} item={item} grams={fixedIngredientGrams?.[item.id] ?? calculations.ingredientGrams[item.id] ?? 0} calculationMode={calculationMode} onUpdate={updateIngredient} onGramsChange={updateIngredientGrams} onRemove={removeIngredient} />)}
          <div className="add-row"><button onClick={() => addIngredient('flour')}>＋ Mehl</button><button onClick={() => addIngredient('sourdough')}>＋ Sauerteig</button><button onClick={() => addIngredient('liquid')}>＋ Wasser / Flüssigkeit</button><button onClick={() => addIngredient('salt')}>＋ Salz</button><button onClick={() => addIngredient('yeast')}>＋ Hefe</button><button onClick={() => addIngredient('other')}>＋ Sonstige</button></div>
        </div>
      </section>
      <footer className="footer-note"><span>⌘</span> Deine Daten bleiben in diesem Browser. Exportiere regelmäßig eine YAML-Sicherung.</footer>
      {notice && <button className="notice" onClick={() => setNotice('')}>{notice} ×</button>}
      <button className="delete-button" onClick={removeCurrent}>Rezept löschen</button>
    </main>
  </div>
}

function Kpi({ label, value, detail, accent }: { label: string, value: string, detail: string, accent: string }) { return <div className={`kpi-card ${accent}`}><div className="kpi-top"><span>{label}</span><i>↗</i></div><strong>{value}</strong><small>{detail}</small></div> }

function IngredientRow({ item, grams, calculationMode, onUpdate, onGramsChange, onRemove }: { item: Ingredient, grams: number, calculationMode: 'dough' | 'ingredients', onUpdate: (id: string, patch: Partial<Ingredient>) => void, onGramsChange: (id: string, grams: number) => void, onRemove: (id: string) => void }) {
  const [gramsDraft, setGramsDraft] = useState(String(grams))
  useEffect(() => setGramsDraft(String(grams)), [grams])
  const setKind = (kind: IngredientKind) => { const patch: Partial<Ingredient> = { kind }; if (kind === 'liquid') Object.assign(patch, { liquidKind: 'water', name: 'Wasser', waterContent: 100 }); if (kind === 'sourdough') Object.assign(patch, { name: 'Rogg en sauerteig'.replace(/ /g, ''), grain: 'Roggen', sourdoughTa: 200 }); if (kind === 'yeast') Object.assign(patch, { name: 'Frischhefe', yeastKind: 'fresh' }); onUpdate(item.id, patch) }
  const switchYeast = (value: YeastKind) => onUpdate(item.id, { yeastKind: value, percentage: convertYeastPercentage(item.percentage, item.yeastKind || 'fresh', value), name: value === 'fresh' ? 'Frischhefe' : 'Trockenhefe' })
  const commitGrams = () => onGramsChange(item.id, num(gramsDraft))
  return <div className={`ingredient-row ${item.kind}`}><div className="ingredient-name"><span className={`ingredient-icon ${item.kind}`}>{item.kind === 'flour' ? '✣' : item.kind === 'sourdough' ? '◒' : item.kind === 'liquid' ? '◌' : item.kind === 'salt' ? '◇' : item.kind === 'yeast' ? '♧' : '✦'}</span>{item.kind === 'other' || (item.kind === 'liquid' && item.liquidKind === 'other') ? <input value={item.name} onChange={(e) => onUpdate(item.id, { name: e.target.value })} /> : <strong>{item.name}</strong>}</div><div className="ingredient-detail"><select value={item.kind} onChange={(e) => setKind(e.target.value as IngredientKind)}><option value="flour">Mehl</option><option value="sourdough">Sauerteig</option><option value="liquid">Wasser / Flüssigkeit</option><option value="salt">Salz</option><option value="yeast">Hefe</option><option value="other">Sonstige</option></select>{item.kind === 'flour' && <select value={item.name} onChange={(e) => onUpdate(item.id, { name: e.target.value })}>{flourTypes.map((type) => <option key={type}>{type}</option>)}</select>}{item.kind === 'sourdough' && <><select value={item.grain} onChange={(e) => onUpdate(item.id, { grain: e.target.value as Grain, name: `${e.target.value}nsauerteig` })}>{grains.map((grain) => <option key={grain}>{grain}</option>)}</select><label>TA <input type="number" value={item.sourdoughTa} onChange={(e) => onUpdate(item.id, { sourdoughTa: num(e.target.value) })} /></label></>}{item.kind === 'liquid' && <><select value={item.liquidKind} onChange={(e) => { const value = e.target.value as LiquidKind; onUpdate(item.id, { liquidKind: value, name: value === 'water' ? 'Wasser' : value === 'milk' ? 'Milch' : 'Sonstige Flüssigkeit', waterContent: value === 'water' ? 100 : value === 'milk' ? 87 : 0 }) }}>{<><option value="water">Wasser</option><option value="milk">Milch</option><option value="other">Sonstige</option></>}</select>{item.liquidKind === 'other' && <label>Wasseranteil % <input type="number" value={item.waterContent} onChange={(e) => onUpdate(item.id, { waterContent: num(e.target.value) })} /></label>}</>}{item.kind === 'yeast' && <select value={item.yeastKind} onChange={(e) => switchYeast(e.target.value as YeastKind)}><option value="fresh">Frischhefe</option><option value="dry">Trockenhefe</option></select>}{item.kind === 'other' && <label>Wasseranteil % <input type="number" value={item.waterContent} onChange={(e) => onUpdate(item.id, { waterContent: num(e.target.value) })} /></label>}</div><div className="percentage-input"><input type="number" min="0" step="0.1" value={item.percentage} disabled={calculationMode === 'ingredients'} onChange={(e) => onUpdate(item.id, { percentage: num(e.target.value) })} /><span>%</span></div><div className="grams-value"><input type="number" min="0" step="1" value={gramsDraft} disabled={calculationMode === 'dough'} onChange={(e) => setGramsDraft(e.target.value)} onBlur={commitGrams} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} aria-label={`${item.name} in Gramm`} /><span>g</span></div><button className="remove-button" onClick={() => onRemove(item.id)} aria-label={`${item.name} entfernen`}>×</button></div>
}

export default App
