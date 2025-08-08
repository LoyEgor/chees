// Локальный клиент для выгрузки партий пользователя с lichess.org
// Документация API: https://lichess.org/api#operation/apiGamesUser

import type { SerializedIndex } from './indexer'
import { MoveIndex } from './indexer'
import { Chess } from 'chess.js'

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

function pgnToSanMoves(pgn: string): string[] {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn, { strict: false })
  } catch {
    return []
  }
  return chess.history()
}

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
      const sanMoves = pgnToSanMoves(obj.pgn)
      index.ingestSanMoves(sanMoves)
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
    const parsed = JSON.parse(raw) as SerializedIndex
    return MoveIndex.fromSerialized(parsed)
  } catch {
    return null
  }
}


