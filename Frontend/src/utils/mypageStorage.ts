const PROFILE_KEY = 'naily_user_profile'
const DESIGNS_KEY = 'naily_saved_designs'
const PRINTS_KEY = 'naily_print_orders'
const FAVORITES_KEY = 'naily_favorites'

export type UserProfile = {
  email: string
  nickname: string
  name: string
}

export type SavedDesign = {
  id: string
  imageUrl: string
  prompt: string
  createdAt: string
  shape?: string
}

export type PrintOrder = {
  id: string
  designId: string
  imageUrl: string
  status: 'queued' | 'printing' | 'completed'
  orderedAt: string
}

export type FavoriteItem = {
  id: string
  imageUrl: string
  prompt: string
  savedAt: string
}

const DEFAULT_PROFILE: UserProfile = {
  email: 'user@naily.com',
  nickname: '네일리유저',
  name: '회원',
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function getProfile(): UserProfile {
  return { ...DEFAULT_PROFILE, ...readJson<Partial<UserProfile>>(PROFILE_KEY, {}) }
}

export function updateProfile(patch: Partial<Pick<UserProfile, 'nickname'>>): UserProfile {
  const next = { ...getProfile(), ...patch }
  writeJson(PROFILE_KEY, next)
  return next
}

export function getSavedDesigns(): SavedDesign[] {
  return readJson<SavedDesign[]>(DESIGNS_KEY, [])
}

export function addSavedDesign(design: Omit<SavedDesign, 'id' | 'createdAt'>): SavedDesign {
  const entry: SavedDesign = {
    ...design,
    id: `design-${Date.now()}`,
    createdAt: new Date().toISOString(),
  }
  writeJson(DESIGNS_KEY, [entry, ...getSavedDesigns()])
  return entry
}

export function getPrintOrders(): PrintOrder[] {
  return readJson<PrintOrder[]>(PRINTS_KEY, [])
}

export function addPrintOrder(order: Omit<PrintOrder, 'id' | 'orderedAt' | 'status'>): PrintOrder {
  const entry: PrintOrder = {
    ...order,
    id: `print-${Date.now()}`,
    status: 'queued',
    orderedAt: new Date().toISOString(),
  }
  writeJson(PRINTS_KEY, [entry, ...getPrintOrders()])
  return entry
}

export function getFavorites(): FavoriteItem[] {
  return readJson<FavoriteItem[]>(FAVORITES_KEY, [])
}

export function toggleFavorite(item: Omit<FavoriteItem, 'id' | 'savedAt'>): FavoriteItem[] {
  const favorites = getFavorites()
  const exists = favorites.find((f) => f.imageUrl === item.imageUrl)
  const next = exists
    ? favorites.filter((f) => f.imageUrl !== item.imageUrl)
    : [{ ...item, id: `fav-${Date.now()}`, savedAt: new Date().toISOString() }, ...favorites]
  writeJson(FAVORITES_KEY, next)
  return next
}

export function isFavorite(imageUrl: string): boolean {
  return getFavorites().some((f) => f.imageUrl === imageUrl)
}
