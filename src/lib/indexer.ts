import { Chess } from 'chess.js'
import type { Move } from 'chess.js'

export type UciMove = string // e2e4, e7e8q

export type PositionBucket = {
  total: number
  moveCounts: Map<string, number> // key: from-to (e2e4, include promotion suffix)
  toSquareCounts: Map<string, number> // target square -> count
  fromSquareCounts: Map<string, number> // from square -> count
  results: { win: number; loss: number; draw: number } // итоги партии относительно пользователя
  // Разделение по роли: ходы пользователя и соперника в этой позиции
  userTotal: number
  userMoveCounts: Map<string, number>
  userToSquareCounts: Map<string, number>
  oppTotal: number
  oppMoveCounts: Map<string, number>
  oppToSquareCounts: Map<string, number>
  // Разделение по цветам
  userWhiteTotal: number
  userWhiteMoveCounts: Map<string, number>
  userWhiteToSquareCounts: Map<string, number>
  userBlackTotal: number
  userBlackMoveCounts: Map<string, number>
  userBlackToSquareCounts: Map<string, number>
  oppWhiteTotal: number
  oppWhiteMoveCounts: Map<string, number>
  oppWhiteToSquareCounts: Map<string, number>
  oppBlackTotal: number
  oppBlackMoveCounts: Map<string, number>
  oppBlackToSquareCounts: Map<string, number>
}

export type SerializedBucket = {
  t: number
  m: [string, number][]
  to: [string, number][]
  fr: [string, number][]
  r: [number, number, number] // [win, loss, draw]
  ut: number
  um: [string, number][]
  uto: [string, number][]
  ot: number
  om: [string, number][]
  oto: [string, number][]
  // Новый срез по цветам
  uwt: number
  uwm: [string, number][]
  uwto: [string, number][]
  ubt: number
  ubm: [string, number][]
  ubto: [string, number][]
  owt: number
  owm: [string, number][]
  owto: [string, number][]
  obt: number
  obm: [string, number][]
  obto: [string, number][]
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

  ingestGamePgn(username: string, pgn: string): void {
    const chess = new Chess()
    try {
      chess.loadPgn(pgn, { strict: false })
    } catch {
      return
    }

    const headers = chess.getHeaders()
    const userLower = username.trim().toLowerCase()
    const whiteName = (headers['White'] || '').toString().trim().toLowerCase()
    const blackName = (headers['Black'] || '').toString().trim().toLowerCase()
    const resultTag = (headers['Result'] || '').toString().trim() // '1-0' | '0-1' | '1/2-1/2' | '*'

    let outcome: 'win' | 'loss' | 'draw' | null = null
    if (resultTag === '1-0' || resultTag === '0-1' || resultTag === '1/2-1/2') {
      const userIsWhite = userLower === whiteName
      const userIsBlack = userLower === blackName
      if (!userIsWhite && !userIsBlack) {
        // Игры не пользователя — пропускаем
        return
      }
      if (resultTag === '1/2-1/2') outcome = 'draw'
      else if (resultTag === '1-0') outcome = userIsWhite ? 'win' : 'loss'
      else if (resultTag === '0-1') outcome = userIsBlack ? 'win' : 'loss'
    }

    // Прокрутим заново по ходам, чтобы собрать позиции до каждого хода и сами ходы
    const seenThisGame = new Set<string>()
    const walker = new Chess()
    const moves = chess.history() as string[]
    for (const san of moves) {
      const fenBefore = walker.fen()
      // Индексация хода
      let m: Move | null = null
      try {
        m = walker.move(san) as Move
      } catch {
        break
      }
      if (!m) break
      const promotion = m.promotion
      const colorToMove = m.color // 'w' | 'b'
      const byUser = (colorToMove === 'w' && userLower === whiteName) || (colorToMove === 'b' && userLower === blackName)
      this.addMove(fenBefore, { from: m.from, to: m.to, promotion }, byUser, colorToMove)
      // Регистрируем результат для позиции (по одному разу за игру)
      if (!seenThisGame.has(fenBefore) && outcome) {
        this.addResult(fenBefore, outcome)
        seenThisGame.add(fenBefore)
      }
    }
  }

  private addMove(
    fen: string,
    params: { from: string; to: string; promotion?: string },
    byUser?: boolean,
    color?: 'w' | 'b'
  ): void {
    let bucket = this.index.get(fen)
    if (!bucket) {
      bucket = {
        total: 0,
        moveCounts: new Map(),
        toSquareCounts: new Map(),
        fromSquareCounts: new Map(),
        results: { win: 0, loss: 0, draw: 0 },
        userTotal: 0,
        userMoveCounts: new Map(),
        userToSquareCounts: new Map(),
        oppTotal: 0,
        oppMoveCounts: new Map(),
        oppToSquareCounts: new Map(),
        userWhiteTotal: 0,
        userWhiteMoveCounts: new Map(),
        userWhiteToSquareCounts: new Map(),
        userBlackTotal: 0,
        userBlackMoveCounts: new Map(),
        userBlackToSquareCounts: new Map(),
        oppWhiteTotal: 0,
        oppWhiteMoveCounts: new Map(),
        oppWhiteToSquareCounts: new Map(),
        oppBlackTotal: 0,
        oppBlackMoveCounts: new Map(),
        oppBlackToSquareCounts: new Map()
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

    if (byUser === true) {
      bucket.userTotal += 1
      bucket.userMoveCounts.set(key, (bucket.userMoveCounts.get(key) ?? 0) + 1)
      bucket.userToSquareCounts.set(
        params.to,
        (bucket.userToSquareCounts.get(params.to) ?? 0) + 1
      )
      if (color === 'w') {
        bucket.userWhiteTotal += 1
        bucket.userWhiteMoveCounts.set(key, (bucket.userWhiteMoveCounts.get(key) ?? 0) + 1)
        bucket.userWhiteToSquareCounts.set(
          params.to,
          (bucket.userWhiteToSquareCounts.get(params.to) ?? 0) + 1
        )
      } else if (color === 'b') {
        bucket.userBlackTotal += 1
        bucket.userBlackMoveCounts.set(key, (bucket.userBlackMoveCounts.get(key) ?? 0) + 1)
        bucket.userBlackToSquareCounts.set(
          params.to,
          (bucket.userBlackToSquareCounts.get(params.to) ?? 0) + 1
        )
      }
    } else if (byUser === false) {
      bucket.oppTotal += 1
      bucket.oppMoveCounts.set(key, (bucket.oppMoveCounts.get(key) ?? 0) + 1)
      bucket.oppToSquareCounts.set(
        params.to,
        (bucket.oppToSquareCounts.get(params.to) ?? 0) + 1
      )
      if (color === 'w') {
        bucket.oppWhiteTotal += 1
        bucket.oppWhiteMoveCounts.set(key, (bucket.oppWhiteMoveCounts.get(key) ?? 0) + 1)
        bucket.oppWhiteToSquareCounts.set(
          params.to,
          (bucket.oppWhiteToSquareCounts.get(params.to) ?? 0) + 1
        )
      } else if (color === 'b') {
        bucket.oppBlackTotal += 1
        bucket.oppBlackMoveCounts.set(key, (bucket.oppBlackMoveCounts.get(key) ?? 0) + 1)
        bucket.oppBlackToSquareCounts.set(
          params.to,
          (bucket.oppBlackToSquareCounts.get(params.to) ?? 0) + 1
        )
      }
    }
  }

  private addResult(fen: string, outcome: 'win' | 'loss' | 'draw'): void {
    let bucket = this.index.get(fen)
    if (!bucket) {
      bucket = {
        total: 0,
        moveCounts: new Map(),
        toSquareCounts: new Map(),
        fromSquareCounts: new Map(),
        results: { win: 0, loss: 0, draw: 0 },
        userTotal: 0,
        userMoveCounts: new Map(),
        userToSquareCounts: new Map(),
        oppTotal: 0,
        oppMoveCounts: new Map(),
        oppToSquareCounts: new Map(),
        userWhiteTotal: 0,
        userWhiteMoveCounts: new Map(),
        userWhiteToSquareCounts: new Map(),
        userBlackTotal: 0,
        userBlackMoveCounts: new Map(),
        userBlackToSquareCounts: new Map(),
        oppWhiteTotal: 0,
        oppWhiteMoveCounts: new Map(),
        oppWhiteToSquareCounts: new Map(),
        oppBlackTotal: 0,
        oppBlackMoveCounts: new Map(),
        oppBlackToSquareCounts: new Map()
      }
      this.index.set(fen, bucket)
    }
    bucket.results[outcome] += 1
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
        fr: Array.from(b.fromSquareCounts.entries()),
        r: [b.results.win, b.results.loss, b.results.draw],
        ut: b.userTotal,
        um: Array.from(b.userMoveCounts.entries()),
        uto: Array.from(b.userToSquareCounts.entries()),
        ot: b.oppTotal,
        om: Array.from(b.oppMoveCounts.entries()),
        oto: Array.from(b.oppToSquareCounts.entries()),
        uwt: b.userWhiteTotal,
        uwm: Array.from(b.userWhiteMoveCounts.entries()),
        uwto: Array.from(b.userWhiteToSquareCounts.entries()),
        ubt: b.userBlackTotal,
        ubm: Array.from(b.userBlackMoveCounts.entries()),
        ubto: Array.from(b.userBlackToSquareCounts.entries()),
        owt: b.oppWhiteTotal,
        owm: Array.from(b.oppWhiteMoveCounts.entries()),
        owto: Array.from(b.oppWhiteToSquareCounts.entries()),
        obt: b.oppBlackTotal,
        obm: Array.from(b.oppBlackMoveCounts.entries()),
        obto: Array.from(b.oppBlackToSquareCounts.entries())
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
        fromSquareCounts: new Map(s.fr),
        results: { win: s.r?.[0] ?? 0, loss: s.r?.[1] ?? 0, draw: s.r?.[2] ?? 0 },
        userTotal: s.ut ?? 0,
        userMoveCounts: new Map(s.um ?? []),
        userToSquareCounts: new Map(s.uto ?? []),
        oppTotal: s.ot ?? 0,
        oppMoveCounts: new Map(s.om ?? []),
        oppToSquareCounts: new Map(s.oto ?? []),
        userWhiteTotal: s.uwt ?? 0,
        userWhiteMoveCounts: new Map(s.uwm ?? []),
        userWhiteToSquareCounts: new Map(s.uwto ?? []),
        userBlackTotal: s.ubt ?? 0,
        userBlackMoveCounts: new Map(s.ubm ?? []),
        userBlackToSquareCounts: new Map(s.ubto ?? []),
        oppWhiteTotal: s.owt ?? 0,
        oppWhiteMoveCounts: new Map(s.owm ?? []),
        oppWhiteToSquareCounts: new Map(s.owto ?? []),
        oppBlackTotal: s.obt ?? 0,
        oppBlackMoveCounts: new Map(s.obm ?? []),
        oppBlackToSquareCounts: new Map(s.obto ?? [])
      })
    }
    return idx
  }

  getResultStats(fen: string): { win: number; loss: number; draw: number; total: number } {
    const b = this.index.get(fen)
    if (!b) return { win: 0, loss: 0, draw: 0, total: 0 }
    const { win, loss, draw } = b.results
    return { win, loss, draw, total: win + loss + draw }
  }
}


