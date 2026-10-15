import { useEffect, useMemo, useRef, useState } from 'react'
import yaml from 'js-yaml'
import { createRecipePdf } from './pdf'
import { blankRecipe, flourTypes, grains, uid } from './types'
import type { Grain, Ingredient, IngredientKind, LiquidKind, PreparationStep, Recipe, YeastKind } from './types'
import { deleteRecipe, loadRecipes, saveRecipe } from './db'
import { calculateRecipe, calculateRecipeFromIngredientGrams, convertYeastPercentage, percentageForIngredientGrams, percentagesFromIngredientGrams, updateIngredientPercentage, totalFlourPercentage, migrateSourdoughPercentages, removeRecipeIngredient, updateSourdoughTa, setIngredientLocked, canRemoveRecipeIngredient, rebalanceFreeFlour } from './calculations'
import { canReorderPreparationStep, canReorderPreparationStepToEnd, reorderPreparationStep } from './preparation'

const round = (n: number) => Math.round(n * 10) / 10
const MAX_PREPARATION_DEPTH = 2
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
  const [editingIngredientOrder, setEditingIngredientOrder] = useState<string[] | null>(null)
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
    const slug = (recipe.title || 'funky-doughs-rezept').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '')
    const doc = createRecipePdf(recipe, doughWeight, calculations)
    const filename = `${slug || 'funky-doughs-rezept'}.pdf`
    if (/Android/i.test(navigator.userAgent)) {
      const url = URL.createObjectURL(doc.output('blob'))
      const opened = window.open(url, '_blank')
      if (!opened) {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } else {
      doc.save(filename)
    }
    setNotice('PDF exportiert')
  }

  const importYaml = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return
    try {
      const parsed = yaml.load(await file.text()) as { recipes?: Recipe[] }
      if (!Array.isArray(parsed?.recipes)) throw new Error('Ungültiges Format')
      for (const item of parsed.recipes) await saveRecipe(migrateSourdoughPercentages(item))
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
  const updateIngredient = (id: string, patch: Partial<Ingredient>) => updateRecipe((current) => {
    const original = current.ingredients.find((item) => item.id === id)
    if (!original || original.locked) return current
    const hasFlour = (item: Ingredient) => item.kind === 'flour' || item.kind === 'sourdough'
    if (patch.kind && !hasFlour({ ...original, kind: patch.kind }) && hasFlour(original)
      && !current.ingredients.some((item) => item.id !== id && hasFlour(item) && !item.locked)) return current
    let updated = { ...current, ingredients: current.ingredients.map((item) => item.id === id ? { ...item, ...patch } : item) }
    const fixedGrams = calculationMode === 'ingredients'
      ? Object.fromEntries(current.ingredients.map((item) => [item.id, fixedIngredientGrams?.[item.id] ?? calculations.ingredientGrams[item.id] ?? 0]))
      : undefined
    if (patch.sourdoughTa !== undefined) {
      updated = updateSourdoughTa(updated, id, patch.sourdoughTa, fixedGrams)
    } else if (patch.percentage !== undefined) {
      updated = updateIngredientPercentage(updated, id, patch.percentage)
    } else if (patch.kind !== undefined) {
      updated = fixedGrams ? percentagesFromIngredientGrams(updated, fixedGrams) : rebalanceFreeFlour(updated)
    }
    return updated
  })
  const toggleIngredientLock = (id: string) => updateRecipe((current) => {
    const item = current.ingredients.find((candidate) => candidate.id === id)
    return item ? setIngredientLocked(current, id, !item.locked) : current
  })
  const updateIngredientGrams = (id: string, grams: number) => {
    if (recipe.ingredients.find((item) => item.id === id)?.locked) return
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
  const removeIngredient = (id: string) => {
    if (!canRemoveRecipeIngredient(recipe, id)) return
    if (calculationMode === 'ingredients') {
      const remainingGrams = Object.fromEntries(recipe.ingredients
        .filter((item) => item.id !== id)
        .map((item) => [item.id, fixedIngredientGrams?.[item.id] ?? calculations.ingredientGrams[item.id] ?? 0]))
      setFixedIngredientGrams(remainingGrams)
      setDoughWeight(round(Object.values(remainingGrams).reduce((sum, grams) => sum + grams, 0)))
      updateRecipe((current) => removeRecipeIngredient(current, id, remainingGrams))
    } else {
      updateRecipe((current) => removeRecipeIngredient(current, id))
    }
  }

  const calculations = useMemo(() => calculationMode === 'ingredients' && fixedIngredientGrams
    ? calculateRecipeFromIngredientGrams(recipe, fixedIngredientGrams)
    : calculateRecipe(recipe, doughWeight), [recipe, doughWeight, calculationMode, fixedIngredientGrams])
  const flourPercentageSum = round(totalFlourPercentage(recipe))
  const freeFlourIds = recipe.ingredients.filter((item) => (item.kind === 'flour' || item.kind === 'sourdough') && !item.locked).map((item) => item.id)
  const displayedIngredients = sortedIngredients(recipe.ingredients)
  if (editingIngredientOrder) {
    const positions = new Map(editingIngredientOrder.map((id, index) => [id, index]))
    displayedIngredients.sort((a, b) => (positions.get(a.id) ?? positions.size) - (positions.get(b.id) ?? positions.size))
  }

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
      <section className="editor-header"><label className="title-field"><span>Rezepttitel <em>bearbeiten</em></span><input className="title-input" value={recipe.title} onChange={(event) => updateTitle(event.target.value)} aria-label="Rezepttitel" /></label><div className="recipe-meta"><p>Bäckerprozente beziehen sich auf die Gesamtmehlmenge, inklusive Mehl aus Sauerteigen. Beim Sauerteig zählt die gesamte Menge inklusive Wasser.</p><div className="calculation-controls"><label>Berechnung</label><div className="mode-switch"><button className={calculationMode === 'dough' ? 'active' : ''} onClick={() => changeCalculationMode('dough')}>Teigmenge fest</button><button className={calculationMode === 'ingredients' ? 'active' : ''} onClick={() => changeCalculationMode('ingredients')}>Zutatenmengen fest</button></div><label>Teigmenge <NumericInput value={doughWeight} min={1} step={10} disabled={calculationMode === 'ingredients'} onCommit={(value) => setDoughWeight(Math.max(1, value))} ariaLabel="Teigmenge in Gramm" /> <span>g</span></label><button className="pdf-button" onClick={exportPdf}>⇩ PDF exportieren</button></div></div></section>
      <section className="kpi-grid"><Kpi label="Gesamt-TA" value={`${calculations.ta} %`} detail="Mehl + Wasser" accent="orange" /><Kpi label="Versäuertes Mehl" value={`${calculations.sourdough} %`} detail="Anteil an Gesamtmehl" accent="green" /><Kpi label="Gesamtmehlmenge" value={`${calculations.totalFlourGrams} g`} detail="inkl. Sauerteigmehl" accent="purple" /></section>
      <section className="ingredients-section"><div className="section-heading"><div><span className="eyebrow">ZUTATEN</span><h2>Deine Zutaten</h2></div><span className="ingredient-count">{recipe.ingredients.length} Einträge</span></div>
        <p className="ingredient-lock-hint">Fixiere Zutaten über die Schalter in der Spalte „Fixieren“. Der Mehlausgleich erfolgt über die freien Zutaten.</p>
        {flourPercentageSum !== 100 && <div className="flour-warning" role="alert">
          <strong>Mehlanteile ergeben {flourPercentageSum.toLocaleString('de-DE')} % statt 100 %.</strong>
          <span>Die Anteile aller Mehle und des Mehls aus den Sauerteigen müssen zusammen 100 % ergeben. Bitte prüfe die Zutaten.</span>
        </div>}
        <div className="ingredient-table" onFocusCapture={(event) => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
            setEditingIngredientOrder(sortedIngredients(recipe.ingredients).map((item) => item.id))
          }
        }} onBlurCapture={() => setEditingIngredientOrder(null)}><div className="table-head"><span>Zutat</span><span>Typ / Details</span><span>Bäcker-%</span><span>Gramm</span><span>Fixieren</span><span /></div>
          {displayedIngredients.map((item) => <IngredientRow key={item.id} item={item} grams={fixedIngredientGrams?.[item.id] ?? calculations.ingredientGrams[item.id] ?? 0} calculationMode={calculationMode} onUpdate={updateIngredient} onGramsChange={updateIngredientGrams} onRemove={removeIngredient} onToggleLock={toggleIngredientLock} lastFreeFlour={freeFlourIds.length === 1 && freeFlourIds[0] === item.id} canRemove={canRemoveRecipeIngredient(recipe, item.id)} />)}
          <div className="add-row"><button onClick={() => addIngredient('flour')}>＋ Mehl</button><button onClick={() => addIngredient('sourdough')}>＋ Sauerteig</button><button onClick={() => addIngredient('liquid')}>＋ Wasser / Flüssigkeit</button><button onClick={() => addIngredient('salt')}>＋ Salz</button><button onClick={() => addIngredient('yeast')}>＋ Hefe</button><button onClick={() => addIngredient('other')}>＋ Sonstige</button></div>
        </div>
      </section>
      <PreparationSection preparation={recipe.preparation || []} onChange={(preparation) => updateRecipe((current) => ({ ...current, preparation }))} />
      <footer className="footer-note"><span>⌘</span> Deine Daten bleiben in diesem Browser. Exportiere regelmäßig eine YAML-Sicherung.</footer>
      {notice && <button className="notice" onClick={() => setNotice('')}>{notice} ×</button>}
      <button className="delete-button" onClick={removeCurrent}>Rezept löschen</button>
    </main>
  </div>
}

function Kpi({ label, value, detail, accent }: { label: string, value: string, detail: string, accent: string }) { return <div className={`kpi-card ${accent}`}><div className="kpi-top"><span>{label}</span><i>↗</i></div><strong>{value}</strong><small>{detail}</small></div> }

function PreparationSection({ preparation, onChange }: { preparation: PreparationStep[], onChange: (preparation: PreparationStep[]) => void }) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  const beginDrag = (id: string) => { draggedIdRef.current = id; setDraggedId(id); setDragOverId(null) }
  const clearDrag = () => { draggedIdRef.current = null; setDraggedId(null); setDragOverId(null) }
  const updateAt = (steps: PreparationStep[], id: string, update: (step: PreparationStep) => PreparationStep): PreparationStep[] => steps.map((step) => step.id === id ? update(step) : { ...step, children: updateAt(step.children || [], id, update) })
  const removeAt = (steps: PreparationStep[], id: string): PreparationStep[] => steps.filter((step) => step.id !== id).map((step) => ({ ...step, children: removeAt(step.children || [], id) }))
  const addStep = (parentId?: string) => {
    const next: PreparationStep = { id: uid(), text: '', children: [] }
    if (!parentId) onChange([...preparation, next])
    else onChange(updateAt(preparation, parentId, (step) => ({ ...step, children: [...(step.children || []), next] })))
  }
  const updateText = (id: string, text: string) => onChange(updateAt(preparation, id, (step) => ({ ...step, text })))
  const removeStep = (id: string) => onChange(removeAt(preparation, id))
  const canDropBefore = (targetId: string) => Boolean(draggedId && canReorderPreparationStep(preparation, draggedId, targetId))
  const moveStep = (sourceId: string, targetId: string) => onChange(reorderPreparationStep(preparation, sourceId, targetId))
  const moveStepToEnd = (sourceId: string) => onChange(reorderPreparationStep(preparation, sourceId))
  const renderSteps = (steps: PreparationStep[], prefix: string, depth: number): React.ReactNode => <>{steps.map((step, index) => {
    const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`
    const isDropTarget = Boolean(dragOverId === step.id && canDropBefore(step.id))
    return <div className={`preparation-node depth-${depth} ${isDropTarget ? 'drop-target' : ''}`} key={step.id} onMouseEnter={() => setDragOverId(canDropBefore(step.id) ? step.id : null)} onMouseUp={() => { const sourceId = draggedIdRef.current ?? draggedId; if (sourceId && canDropBefore(step.id)) moveStep(sourceId, step.id); if (sourceId) clearDrag() }}>
      <div className="preparation-row" onMouseUp={() => { const sourceId = draggedIdRef.current ?? draggedId; if (sourceId) clearDrag() }}><span className="drag-handle" title="Ziehen zum Verschieben" onMouseDown={(event) => { event.preventDefault(); beginDrag(step.id) }} onMouseUp={clearDrag}>⠿</span><span className="step-number">{depth === 0 ? `${number}.` : number}</span><input value={step.text} placeholder={depth === 0 ? 'Nächsten Zubereitungsschritt eingeben …' : 'Unterschritt eingeben …'} onChange={(event) => updateText(step.id, event.target.value)} aria-label={`Zubereitungsschritt ${number}`} /><button className="remove-button" onClick={() => removeStep(step.id)} aria-label={`Schritt ${number} entfernen`}>×</button></div>
      <div className="preparation-children">{step.children?.length ? renderSteps(step.children, number, depth + 1) : null}</div>
      {depth < MAX_PREPARATION_DEPTH && <button className="add-substep" onClick={() => addStep(step.id)}>＋ Unterschritt</button>}
    </div>
  })}<div className={`preparation-end-marker ${draggedId && dragOverId === '__end__' + prefix && canReorderPreparationStepToEnd(preparation, draggedId, steps[0].id) ? 'active' : ''}`} onMouseEnter={() => setDragOverId(draggedId && canReorderPreparationStepToEnd(preparation, draggedId, steps[0].id) ? '__end__' + prefix : null)} onMouseUp={() => { const sourceId = draggedIdRef.current ?? draggedId; if (sourceId && canReorderPreparationStepToEnd(preparation, sourceId, steps[0].id)) moveStepToEnd(sourceId); clearDrag() }} /></>
  return <section className="preparation-section"><div className="section-heading"><div><span className="eyebrow">ABLAUF</span><h2>Zubereitung</h2></div><span className="ingredient-count">{preparation.length} Schritte</span></div><div className="preparation-card">{preparation.length ? <div className="preparation-list">{renderSteps(preparation, '', 0)}</div> : <p className="preparation-empty">Halte hier fest, wie aus deinen Zutaten ein gutes Brot wird.</p>}<button className="add-preparation" onClick={() => addStep()}>＋ Schritt hinzufügen</button></div></section>
}

function NumericInput({ value, onCommit, disabled = false, min, max, step, ariaLabel }: { value: number, onCommit: (value: number) => void, disabled?: boolean, min?: number, max?: number, step?: number, ariaLabel?: string }) {
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value))
  }, [value])
  const commit = () => {
    const parsed = draft.trim() === '' ? 0 : Number(draft)
    const nextValue = Number.isFinite(parsed) ? parsed : 0
    if (nextValue !== value) onCommit(nextValue)
    setDraft(String(value))
  }
  const change = (nextDraft: string) => {
    setDraft(nextDraft)
    const parsed = Number(nextDraft)
    if (nextDraft.trim() !== '' && Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
  }
  const blurActiveField = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }
  const adjust = (direction: number) => {
    blurActiveField()
    // Use native stepping rules without focusing the editable field.
    const steppingInput = document.createElement('input')
    steppingInput.type = 'number'
    if (min !== undefined) steppingInput.min = String(min)
    if (max !== undefined) steppingInput.max = String(max)
    steppingInput.step = String(step ?? 1)
    steppingInput.value = String(value)
    steppingInput.stepUp(direction)
    const nextValue = steppingInput.valueAsNumber
    setDraft(String(value))
    if (nextValue !== value) onCommit(nextValue)
  }
  return <span className="numeric-input-control">
    <input ref={inputRef} type="number" min={min} max={max} step={step} value={draft} disabled={disabled} onChange={(event) => change(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} aria-label={ariaLabel} />
    <span className="numeric-step-buttons">
      {[1, -1].map((direction) => <button key={direction} type="button" disabled={disabled} aria-label={`${ariaLabel ?? 'Wert'} ${direction > 0 ? 'erhöhen' : 'verringern'}`} onPointerDown={(event) => { event.preventDefault(); blurActiveField() }} onClick={() => adjust(direction)}>{direction > 0 ? '▴' : '▾'}</button>)}
    </span>
  </span>
}

function IngredientRow({ item, grams, calculationMode, onUpdate, onGramsChange, onRemove, onToggleLock, lastFreeFlour, canRemove }: { item: Ingredient, grams: number, calculationMode: 'dough' | 'ingredients', onUpdate: (id: string, patch: Partial<Ingredient>) => void, onGramsChange: (id: string, grams: number) => void, onRemove: (id: string) => void, onToggleLock: (id: string) => void, lastFreeFlour: boolean, canRemove: boolean }) {
  const setKind = (kind: IngredientKind) => { const patch: Partial<Ingredient> = { kind }; if (kind === 'liquid') Object.assign(patch, { liquidKind: 'water', name: 'Wasser', waterContent: 100 }); if (kind === 'sourdough') Object.assign(patch, { name: 'Rogg en sauerteig'.replace(/ /g, ''), grain: 'Roggen', sourdoughTa: 200 }); if (kind === 'yeast') Object.assign(patch, { name: 'Frischhefe', yeastKind: 'fresh' }); onUpdate(item.id, patch) }
  const switchYeast = (value: YeastKind) => onUpdate(item.id, { yeastKind: value, percentage: convertYeastPercentage(item.percentage, item.yeastKind || 'fresh', value), name: value === 'fresh' ? 'Frischhefe' : 'Trockenhefe' })
  return <div className={`ingredient-row ${item.kind}${item.locked ? ' locked' : ''}`}><div className="ingredient-name"><span className={`ingredient-icon ${item.kind}`}>{item.kind === 'flour' ? '✣' : item.kind === 'sourdough' ? '◒' : item.kind === 'liquid' ? '◌' : item.kind === 'salt' ? '◇' : item.kind === 'yeast' ? '♧' : '✦'}</span>{item.kind === 'other' || (item.kind === 'liquid' && item.liquidKind === 'other') ? <input disabled={!!item.locked} value={item.name} onChange={(e) => onUpdate(item.id, { name: e.target.value })} /> : <strong>{item.name}</strong>}</div><div className="ingredient-detail"><select disabled={!!item.locked} value={item.kind} onChange={(e) => setKind(e.target.value as IngredientKind)}><option value="flour">Mehl</option><option value="sourdough">Sauerteig</option><option disabled={lastFreeFlour} value="liquid">Wasser / Flüssigkeit</option><option disabled={lastFreeFlour} value="salt">Salz</option><option disabled={lastFreeFlour} value="yeast">Hefe</option><option disabled={lastFreeFlour} value="other">Sonstige</option></select>{item.kind === 'flour' && <select disabled={!!item.locked} value={item.name} onChange={(e) => onUpdate(item.id, { name: e.target.value })}>{flourTypes.map((type) => <option key={type}>{type}</option>)}</select>}{item.kind === 'sourdough' && <><select disabled={!!item.locked} value={item.grain} onChange={(e) => onUpdate(item.id, { grain: e.target.value as Grain, name: `${e.target.value}nsauerteig` })}>{grains.map((grain) => <option key={grain}>{grain}</option>)}</select><label>TA <NumericInput disabled={!!item.locked} value={item.sourdoughTa || 200} onCommit={(value) => onUpdate(item.id, { sourdoughTa: value })} min={100} step={1} ariaLabel="Sauerteig-TA" /></label></>}{item.kind === 'liquid' && <><select disabled={!!item.locked} value={item.liquidKind} onChange={(e) => { const value = e.target.value as LiquidKind; onUpdate(item.id, { liquidKind: value, name: value === 'water' ? 'Wasser' : value === 'milk' ? 'Milch' : 'Sonstige Flüssigkeit', waterContent: value === 'water' ? 100 : value === 'milk' ? 87 : 0 }) }}>{<><option value="water">Wasser</option><option value="milk">Milch</option><option disabled={lastFreeFlour} value="other">Sonstige</option></>}</select>{item.liquidKind === 'other' && <label>Wasseranteil % <NumericInput disabled={!!item.locked} value={item.waterContent || 0} onCommit={(value) => onUpdate(item.id, { waterContent: value })} min={0} max={100} step={1} ariaLabel="Wasseranteil" /></label>}</>}{item.kind === 'yeast' && <select disabled={!!item.locked} value={item.yeastKind} onChange={(e) => switchYeast(e.target.value as YeastKind)}><option value="fresh">Frischhefe</option><option value="dry">Trockenhefe</option></select>}{item.kind === 'other' && <label>Wasseranteil % <NumericInput disabled={!!item.locked} value={item.waterContent || 0} onCommit={(value) => onUpdate(item.id, { waterContent: value })} min={0} max={100} step={1} ariaLabel="Wasseranteil" /></label>}</div><div className="percentage-input"><NumericInput value={round(item.percentage)} onCommit={(value) => onUpdate(item.id, { percentage: value })} disabled={!!item.locked || calculationMode === 'ingredients'} min={0} step={0.1} ariaLabel={`${item.name} in Bäckerprozent`} /><span>%</span></div><div className="grams-value"><NumericInput value={grams} onCommit={(value) => onGramsChange(item.id, value)} disabled={!!item.locked || calculationMode === 'dough'} min={0} step={1} ariaLabel={`${item.name} in Gramm`} /><span>g</span></div><div className="ingredient-fix" data-label="Fixieren"><button type="button" role="switch" aria-checked={!!item.locked} aria-label={`${item.name} fixieren`} className="ingredient-lock" disabled={lastFreeFlour && !item.locked} title={lastFreeFlour && !item.locked ? 'Mindestens eine Mehlzutat muss frei bleiben' : item.locked ? 'Zutat freigeben' : 'Zutat fixieren'} onClick={() => onToggleLock(item.id)}><span className="lock-track" aria-hidden="true"><span /></span><span>{item.locked ? 'Fixiert' : 'Frei'}</span></button></div><button disabled={!canRemove} title={!canRemove ? (item.locked ? 'Zutat zuerst freigeben' : 'Mindestens eine Mehlzutat muss frei bleiben') : undefined} className="remove-button" onClick={() => onRemove(item.id)} aria-label={`${item.name} entfernen`}>×</button></div>
}

export default App
