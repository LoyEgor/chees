// Локальный клиент для выгрузки партий пользователя с lichess.org
// Документация API: https://lichess.org/api#operation/apiGamesUser

import type { SerializedIndex } from './indexer'
import { MoveIndex } from './indexer'
// import { Chess } from 'chess.js'

export type FetchGamesOptions = {
  username: string
  max?: number // максимум партий
  since?: number // unix ms
  until?: number // unix ms
  perfType?: string // blitz, rapid, classical, etc
}

export type LoadResult = {
  index: MoveIndex
  totalGames: number
}

function parseNdjson(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

// (было pgnToSanMoves) — больше не используется; индексация идёт через ingestGamePgn

export async function fetchAndIndexUserGames(options: FetchGamesOptions): Promise<LoadResult> {
  const { username, max, since, until, perfType } = options
  const params = new URLSearchParams()
  params.set('moves', 'true')
  params.set('pgnInJson', 'true')
  params.set('clocks', 'false')
  params.set('evals', 'false')
  params.set('opening', 'false')
  if (max) params.set('max', String(max))
  if (since) params.set('since', String(since))
  if (until) params.set('until', String(until))
  if (perfType) params.set('perfType', perfType)

  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params.toString()}`

  const res = await fetch(url, {
    headers: {
      Accept: 'application/x-ndjson'
    }
  })
  if (!res.ok) {
    throw new Error(`Lichess error: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  const lines = parseNdjson(text)

  const index = new MoveIndex()
  let totalGames = 0
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as any
      if (!obj || !obj.pgn) continue
      totalGames += 1
      // Учитываем результат относительно username и индексацию позиций
      index.ingestGamePgn(username, obj.pgn)
    } catch {
      // ignore
    }
  }

  return { index, totalGames }
}

export function saveIndexToLocalStorage(key: string, index: MoveIndex) {
  const data = index.serialize()
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // ignore
  }
}

export function loadIndexFromLocalStorage(key: string): MoveIndex | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown as Record<string, any>
    // Проверяем схему: требуется наличие полей разбиения по сторонам и цветам
    const firstBucket = parsed && typeof parsed === 'object' ? (Object.values(parsed)[0] as any) : null
    const hasSideSplit = !!firstBucket && (typeof firstBucket === 'object') && ('ut' in firstBucket) && ('om' in firstBucket)
    const hasColorSplit = !!firstBucket && (typeof firstBucket === 'object') && ('uwt' in firstBucket) && ('obm' in firstBucket)
    if (!hasSideSplit || !hasColorSplit) {
      // Старый кэш — игнорируем, чтобы перекачать и пересчитать
      return null
    }
    return MoveIndex.fromSerialized(parsed as SerializedIndex)
  } catch {
    return null
  }
}

// ---------- История ников ----------

const HISTORY_KEY = 'lichess:userHistory'

export function getUserHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as string[]
    if (!Array.isArray(arr)) return []
    return arr.filter((s) => typeof s === 'string')
  } catch {
    return []
  }
}

export function addUserToHistory(username: string): void {
  const u = username.trim()
  if (!u) return
  const current = getUserHistory()
  const existingIndex = current.findIndex((x) => x.toLowerCase() === u.toLowerCase())
  if (existingIndex !== -1) current.splice(existingIndex, 1)
  current.unshift(u)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(current.slice(0, 20)))
  } catch {
    // ignore
  }
}

export function removeUserFromHistory(username: string): void {
  const u = username.trim()
  const current = getUserHistory()
  const next = current.filter((x) => x.toLowerCase() !== u.toLowerCase())
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}


