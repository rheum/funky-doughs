export type IngredientKind = 'flour' | 'sourdough' | 'liquid' | 'salt' | 'yeast' | 'other'
export type LiquidKind = 'water' | 'milk' | 'other'
export type YeastKind = 'fresh' | 'dry'
export type Grain = 'Roggen' | 'Weizen' | 'Dinkel'

export type Ingredient = {
  id: string
  kind: IngredientKind
  name: string
  percentage: number
  locked?: boolean
  grain?: Grain
  type?: string
  liquidKind?: LiquidKind
  waterContent?: number
  sourdoughTa?: number
  yeastKind?: YeastKind
}

export type PreparationStep = {
  id: string
  text: string
  children: PreparationStep[]
}

export type Recipe = {
  id: string
  title: string
  ingredients: Ingredient[]
  preparation?: PreparationStep[]
  sourdoughPercentageBasis?: 'total'
  updatedAt: string
}

export const flourTypes = ['Roggen 1150', 'Roggen Vollkorn', 'Weizen 550', 'Weizen 1050', 'Weizen Vollkorn', 'Dinkel 630', 'Dinkel Vollkorn']
export const grains: Grain[] = ['Roggen', 'Weizen', 'Dinkel']

export const uid = () => crypto.randomUUID()

export const blankRecipe = (): Recipe => ({
  id: uid(), title: 'Mein neues Brot', sourdoughPercentageBasis: 'total', updatedAt: new Date().toISOString(), preparation: [], ingredients: [
    { id: uid(), kind: 'flour', name: 'Weizen 550', percentage: 100, grain: 'Weizen', type: '550' },
    { id: uid(), kind: 'liquid', name: 'Wasser', percentage: 68, liquidKind: 'water', waterContent: 100 },
    { id: uid(), kind: 'salt', name: 'Salz', percentage: 2, waterContent: 0 },
  ],
})
