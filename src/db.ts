import type { Recipe } from './types'
import { migrateSourdoughPercentages } from './calculations'

const DB_NAME = 'teigwerk'
const STORE = 'recipes'

const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

export const loadRecipes = async (): Promise<Recipe[]> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    request.onsuccess = () => resolve((request.result as Recipe[]).map(migrateSourdoughPercentages))
    request.onerror = () => reject(request.error)
  })
}

export const saveRecipe = async (recipe: Recipe) => {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(recipe)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export const deleteRecipe = async (id: string) => {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
