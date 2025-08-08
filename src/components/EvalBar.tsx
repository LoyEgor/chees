import { useEffect, useMemo, useState } from 'react'
import type { EvalUpdate } from '../lib/engine'
import { StockfishEngine } from '../lib/engine'

function scoreToWhiteAdvantage(scoreCp: number | null, mate: number | null, sideToMove: 'w' | 'b'): number {
  // Вернём значение в диапозоне [-1..1], где >0 — преимущество белых
  if (mate !== null) {
    const sign = mate > 0 ? 1 : -1
    // Чем меньше по модулю мат в N, тем ближе к 1 по величине
    const mag = Math.min(1, 1 / Math.max(1, Math.abs(mate)))
    return sign * (0.9 + 0.1 * mag)
  }
  if (scoreCp === null) return 0
  // scoreCp трактуется для стороны, делающей ход; приведём к белому преимуществу
  const asWhite = sideToMove === 'w' ? scoreCp : -scoreCp
  // Сжимаем к [-1..1]
  return Math.max(-1, Math.min(1, asWhite / 800))
}

export default function EvalBar({ fen }: { fen: string }) {
  const [engine] = useState(() => new StockfishEngine())
  const [lastEval, setLastEval] = useState<EvalUpdate>({ scoreCp: null, mate: null })
  const sideToMove = fen.split(' ')[1] as 'w' | 'b'
  const pctWhite = useMemo(() => {
    const v = scoreToWhiteAdvantage(lastEval.scoreCp ?? null, lastEval.mate ?? null, sideToMove)
    // Преобразуем в проценты для белых [0..100]
    return Math.round((v + 1) * 50)
  }, [lastEval, sideToMove])

  useEffect(() => {
    let unsub: (() => void) | null = null
    let mounted = true
    engine.init().then(() => {
      if (!mounted) return
      unsub = engine.onUpdate((u) => setLastEval((p) => ({ ...p, ...u })))
      engine.evaluateFen(fen, 3000)
    })
    return () => {
      unsub?.()
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen])

  const cpLabel = lastEval.mate != null ? `#${lastEval.mate}` : (lastEval.scoreCp != null ? (lastEval.scoreCp / 100).toFixed(2) : '—')

  return (
    <div style={{ width: 18, height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.15)' }}>
      <div style={{ flex: `${pctWhite} 0 0`, background: '#e6e6e6' }} />
      <div style={{ flex: `${100 - pctWhite} 0 0`, background: '#262626' }} />
      <div style={{ marginTop: 6, textAlign: 'center', fontSize: 12, opacity: 0.9 }}>{cpLabel}</div>
    </div>
  )
}


