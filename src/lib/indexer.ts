import { Chess } from 'chess.js'
import type { Move } from 'chess.js'

export type UciMove = string // e2e4, e7e8q

export type PositionBucket = {
  total: number
  moveCounts: Map<string, number> // key: from-to (e2e4, include promotion suffix)
  toSquareCounts: Map<string, number> // target square -> count
  fromSquareCounts: Map<string, number> // from square -> count
}

export type SerializedBucket = {
  t: number
  m: [string, number][]
  to: [string, number][]
  fr: [string, number][]
}

export type SerializedIndex = Record<string, SerializedBucket>

export class MoveIndex {
  private index: Map<string, PositionBucket>

  constructor() {
    this.index = new Map()
  }

  get size(): number {
    return this.index.size
  }

  clear(): void {
    this.index.clear()
  }

  ingestUciMoves(uciMoves: UciMove[]): void {
    const chess = new Chess()
    for (const uci of uciMoves) {
      const fenBefore = chess.fen()
      const from = uci.slice(0, 2)
      const to = uci.slice(2, 4)
      const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined

      this.addMove(fenBefore, { from, to, promotion })
      try {
        chess.move({ from, to, promotion })
      } catch {
        // ignore illegal (in case of corrupted data)
        break
      }
    }
  }

  ingestSanMoves(sanMoves: string[]): void {
    const chess = new Chess()
    for (const san of sanMoves) {
      const fenBefore = chess.fen()
      let move: Move | null = null
      try {
        move = chess.move(san) as Move
      } catch {
        break
      }
      if (!move) break
      const promotion = move.promotion
      this.addMove(fenBefore, { from: move.from, to: move.to, promotion })
    }
  }

  private addMove(
    fen: string,
    params: { from: string; to: string; promotion?: string }
  ): void {
    let bucket = this.index.get(fen)
    if (!bucket) {
      bucket = {
        total: 0,
        moveCounts: new Map(),
        toSquareCounts: new Map(),
        fromSquareCounts: new Map()
      }
      this.index.set(fen, bucket)
    }

    const key = `${params.from}${params.to}${params.promotion ?? ''}`
    bucket.total += 1
    bucket.moveCounts.set(key, (bucket.moveCounts.get(key) ?? 0) + 1)
    bucket.toSquareCounts.set(params.to, (bucket.toSquareCounts.get(params.to) ?? 0) + 1)
    bucket.fromSquareCounts.set(
      params.from,
      (bucket.fromSquareCounts.get(params.from) ?? 0) + 1
    )
  }

  getBucket(fen: string): PositionBucket | null {
    return this.index.get(fen) ?? null
  }

  getTopMoves(
    fen: string,
    limit = 8
  ): Array<{ from: string; to: string; promotion?: string; count: number }> {
    const bucket = this.index.get(fen)
    if (!bucket) return []
    const pairs: Array<{ k: string; c: number }> = []
    for (const [k, c] of bucket.moveCounts) pairs.push({ k, c })
    pairs.sort((a, b) => b.c - a.c)
    return pairs.slice(0, limit).map(({ k, c }) => ({
      from: k.slice(0, 2),
      to: k.slice(2, 4),
      promotion: k.length > 4 ? (k.slice(4) as string) : undefined,
      count: c
    }))
  }

  serialize(): SerializedIndex {
    const out: SerializedIndex = {}
    for (const [fen, b] of this.index) {
      out[fen] = {
        t: b.total,
        m: Array.from(b.moveCounts.entries()),
        to: Array.from(b.toSquareCounts.entries()),
        fr: Array.from(b.fromSquareCounts.entries())
      }
    }
    return out
  }

  static fromSerialized(data: SerializedIndex): MoveIndex {
    const idx = new MoveIndex()
    for (const fen of Object.keys(data)) {
      const s = data[fen]
      idx.index.set(fen, {
        total: s.t,
        moveCounts: new Map(s.m),
        toSquareCounts: new Map(s.to),
        fromSquareCounts: new Map(s.fr)
      })
    }
    return idx
  }
}


