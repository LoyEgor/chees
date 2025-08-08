// Обёртка над Stockfish (WASM) для оценки позиции
// Использует пакет `stockfish` (WASM+worker совместимый)

export type EvalUpdate = {
  depth?: number
  seldepth?: number
  nodes?: number
  nps?: number
  scoreCp?: number | null // оценка в центпешках для стороны, делающей ход
  mate?: number | null // в матах, если есть
  pv?: string | null
}

export class StockfishEngine {
  private worker: Worker | null = null
  private ready = false
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private onUpdateCallbacks: Array<(u: EvalUpdate) => void> = []

  async init(): Promise<void> {
    if (this.worker && this.ready) return
    if (this.worker && !this.ready && this.readyPromise) return this.readyPromise
    // Ищем рабочую сборку: предпочитаем "single" (multi-thread через SharedArrayBuffer может требовать COOP/COEP)
    const w = new Worker(new URL('../../node_modules/stockfish/src/stockfish-nnue-16-single.js', import.meta.url), { type: 'module' })
    this.worker = w
    w.onmessage = (e: MessageEvent<string>) => this.handleMessage(e.data)
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve
    })
    this.ready = false
    this.send('uci')
    return this.readyPromise
  }

  dispose(): void {
    try {
      this.worker?.terminate()
    } catch {}
    this.worker = null
    this.ready = false
  }

  onUpdate(cb: (u: EvalUpdate) => void): () => void {
    this.onUpdateCallbacks.push(cb)
    return () => {
      const i = this.onUpdateCallbacks.indexOf(cb)
      if (i >= 0) this.onUpdateCallbacks.splice(i, 1)
    }
  }

  private emit(u: EvalUpdate) {
    for (const cb of this.onUpdateCallbacks) cb(u)
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd)
  }

  private handleMessage(line: string) {
    if (typeof line !== 'string') return
    if (line.startsWith('uciok')) {
      // Настройки по умолчанию, затем ждём readyok
      this.send('setoption name Threads value 2')
      this.send('setoption name Hash value 64')
      this.send('isready')
      return
    }
    if (line.startsWith('readyok')) {
      this.ready = true
      this.resolveReady?.()
      this.resolveReady = null
      return
    }
    if (line.startsWith('info ')) {
      // Пример: info depth 16 seldepth 29 score cp 32 nodes 12345 nps 100000 pv e2e4 e7e5
      const parts = line.split(' ')
      const upd: EvalUpdate = { scoreCp: null, mate: null, pv: null }
      for (let i = 1; i < parts.length; i++) {
        const k = parts[i]
        const v = parts[i + 1]
        if (k === 'depth') upd.depth = Number(v)
        else if (k === 'seldepth') upd.seldepth = Number(v)
        else if (k === 'nodes') upd.nodes = Number(v)
        else if (k === 'nps') upd.nps = Number(v)
        else if (k === 'score') {
          const type = parts[i + 1]
          const val = Number(parts[i + 2])
          if (type === 'cp') {
            upd.scoreCp = isFinite(val) ? val : null
          } else if (type === 'mate') {
            upd.mate = isFinite(val) ? val : null
          }
        } else if (k === 'pv') {
          upd.pv = parts.slice(i + 1).join(' ')
          break
        }
      }
      this.emit(upd)
      return
    }
    if (line.startsWith('bestmove')) {
      // игнорируем
      return
    }
  }

  evaluateFen(fen: string, movetimeMs = 500): void {
    if (!this.worker || !this.ready) return
    this.send('stop')
    this.send('ucinewgame')
    this.send(`position fen ${fen}`)
    this.send(`go movetime ${movetimeMs}`)
  }
}


