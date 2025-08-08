import { useCallback, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { MoveIndex } from '../lib/indexer'
import { californiaPieces } from '../lib/piecesCalifornia'
import EvalBar from './EvalBar'
import {
  fetchAndIndexUserGames,
  loadIndexFromLocalStorage,
  saveIndexToLocalStorage,
  addUserToHistory,
  getUserHistory,
  removeUserFromHistory
} from '../lib/lichess'

type PromotionPiece = 'q' | 'r' | 'b' | 'n'

type LastMove = {
  from: Square
  to: Square
}

type PendingMove = {
  from: Square
  to: Square
}

function getGameStatus(chess: Chess): {
  label: string
  isTerminal: boolean
} {
  if (chess.isCheckmate()) {
    return { label: 'Мат', isTerminal: true }
  }
  if (chess.isStalemate()) {
    return { label: 'Пат', isTerminal: true }
  }
  if (chess.isDraw()) {
    // Включает 50 ходов, трёхкратное повторение, недостаток материала
    return { label: 'Ничья', isTerminal: true }
  }
  if (chess.isCheck()) {
    return { label: 'Шах', isTerminal: false }
  }
  return { label: '', isTerminal: false }
}

function useForceRerender(): () => void {
  const [, setTick] = useState(0)
  return useCallback(() => setTick((v) => v + 1), [])
}

export default function ChessGame() {
  const chessRef = useRef<Chess>(new Chess())
  const forceRerender = useForceRerender()

  const [fen, setFen] = useState<string>(() => chessRef.current.fen())
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [hoverSquare, setHoverSquare] = useState<Square | null>(null)
  const [legalTargets, setLegalTargets] = useState<Square[]>([])
  const [lastMove, setLastMove] = useState<LastMove | null>(null)

  const [promotionOpen, setPromotionOpen] = useState(false)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  // Индекс ходов пользователя из Lichess
  const [userMovesIndex, setUserMovesIndex] = useState<MoveIndex | null>(null)
  const [isLoadingLichess, setIsLoadingLichess] = useState(false)
  const [lichessLoadedGames, setLichessLoadedGames] = useState<number>(0)
  const [lichessUsername, setLichessUsername] = useState<string>('spritescarbs')
  const [userHistory, setUserHistory] = useState<string[]>(() => getUserHistory())

  const turnColor: 'white' | 'black' = chessRef.current.turn() === 'w' ? 'white' : 'black'
  const status = getGameStatus(chessRef.current)

  const historyVerbose = useMemo(() => chessRef.current.history({ verbose: true }) as Move[], [fen])

  const buildSquareStyles = useCallback((): Record<string, React.CSSProperties> => {
    const styles: Record<string, React.CSSProperties> = {}

    // Подсветка последнего хода
    if (lastMove) {
      styles[lastMove.from] = {
        boxShadow: 'inset 0 0 0 3px rgba(255, 213, 0, 0.85)'
      }
      styles[lastMove.to] = {
        boxShadow: 'inset 0 0 0 3px rgba(255, 213, 0, 0.85)'
      }
    }

    // Подсветка выбранной клетки
    if (selectedSquare) {
      styles[selectedSquare] = {
        boxShadow: 'inset 0 0 0 3px rgba(0, 132, 255, 0.85)'
      }
    }

    // Подсветка наведения мыши
    if (hoverSquare) {
      styles[hoverSquare] = {
        boxShadow: 'inset 0 0 0 3px rgba(100, 100, 255, 0.6)'
      }
    }

    // Подсветка доступных ходов
    for (const target of legalTargets) {
      styles[target] = {
        background:
          'radial-gradient(circle, rgba(20, 85, 30, 0.55) 20%, rgba(0, 0, 0, 0) 21%)',
        backdropFilter: 'saturate(120%)'
      }
    }

    // Подсветка: мои ходы для цвета снизу и ходы соперника для цвета сверху
    if (userMovesIndex) {
      const bucket = userMovesIndex.getBucket(fen)
      if (bucket) {
        const bottomIsWhite = orientation === 'white'
        const myMap = bottomIsWhite ? bucket.userWhiteToSquareCounts : bucket.userBlackToSquareCounts
        const oppMap = bottomIsWhite ? bucket.oppBlackToSquareCounts : bucket.oppWhiteToSquareCounts
        if (myMap && myMap.size > 0) {
          const max = Array.from(myMap.values()).reduce((a, b) => Math.max(a, b), 0)
          for (const [to, count] of myMap) {
            const intensity = Math.max(0.2, Math.min(0.9, count / max))
            const color = `rgba(0, 200, 255, ${intensity.toFixed(3)})` // мои: голубой
            styles[to] = {
              ...(styles[to] || {}),
              boxShadow: `inset 0 0 0 4px ${color}`
            }
          }
        }
        if (oppMap && oppMap.size > 0) {
          const max = Array.from(oppMap.values()).reduce((a, b) => Math.max(a, b), 0)
          for (const [to, count] of oppMap) {
            const intensity = Math.max(0.15, Math.min(0.7, count / max))
            const color = `inset 0 0 0 4px rgba(255, 120, 0, ${intensity.toFixed(3)})` // соперник: оранжевый
            styles[to] = {
              ...(styles[to] || {}),
              boxShadow: styles[to]?.boxShadow
                ? `${styles[to].boxShadow}, ${color}`
                : color
            }
          }
        }
      }
    }

    return styles
  }, [hoverSquare, lastMove, legalTargets, selectedSquare, userMovesIndex, fen])

  const squareStyles = useMemo(() => buildSquareStyles(), [buildSquareStyles])

  // Стрелки: мои для нижней стороны (голубые) и соперника для верхней (оранжевые)
  const lichessArrows = useMemo(() => {
    if (!userMovesIndex) return [] as any[]
    const bucket = userMovesIndex.getBucket(fen)
    if (!bucket) return [] as any[]
    const bottomIsWhite = orientation === 'white'
    const myMap = bottomIsWhite ? bucket.userWhiteMoveCounts : bucket.userBlackMoveCounts
    const oppMap = bottomIsWhite ? bucket.oppBlackMoveCounts : bucket.oppWhiteMoveCounts
    const arrows: any[] = []
    if (myMap && myMap.size > 0) {
      const top = Array.from(myMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
      const max = top.length ? top[0][1] : 1
      for (const [k, c] of top) {
        const from = k.slice(0, 2)
        const to = k.slice(2, 4)
        const t = Math.max(0.35, Math.min(1, c / max))
        arrows.push({ startSquare: from, endSquare: to, color: `rgba(0, 200, 255, ${t.toFixed(3)})` })
      }
    }
    if (oppMap && oppMap.size > 0) {
      const top = Array.from(oppMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
      const max = top.length ? top[0][1] : 1
      for (const [k, c] of top) {
        const from = k.slice(0, 2)
        const to = k.slice(2, 4)
        const t = Math.max(0.25, Math.min(0.85, c / max))
        arrows.push({ startSquare: from, endSquare: to, color: `rgba(255, 140, 0, ${t.toFixed(3)})` })
      }
    }
    return arrows
  }, [userMovesIndex, fen, orientation])

  const setPositionFromGame = useCallback(() => {
    setFen(chessRef.current.fen())
    forceRerender()
  }, [forceRerender])

  const computeLegalTargets = useCallback((square: Square) => {
    const moves = chessRef.current.moves({ square, verbose: true }) as Move[]
    const targets = moves.map((m) => m.to as Square)
    setLegalTargets(targets)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedSquare(null)
    setLegalTargets([])
  }, [])

  const onSquareClick = useCallback(({ square }: { square: string }) => {
    if (status.isTerminal) return
    const sq = square as Square
    const piece = chessRef.current.get(sq)

    if (selectedSquare && legalTargets.includes(sq)) {
      // Попытка сделать ход кликом
      const candidates = chessRef.current.moves({ square: selectedSquare, verbose: true }) as Move[]
      const candidate = candidates.find((m) => m.to === sq)
      if (!candidate) return
      if (candidate.promotion) {
        setPendingMove({ from: selectedSquare, to: sq })
        setPromotionOpen(true)
        return
      }
      chessRef.current.move({ from: selectedSquare, to: sq })
      setLastMove({ from: selectedSquare, to: sq })
      clearSelection()
      setPositionFromGame()
      return
    }

    // Перевыбор или выбор своей фигуры
    if (piece && (piece.color === 'w' ? 'white' : 'black') === turnColor) {
      setSelectedSquare(sq)
      computeLegalTargets(sq)
    } else {
      clearSelection()
    }
  }, [clearSelection, computeLegalTargets, legalTargets, selectedSquare, setPositionFromGame, status.isTerminal, turnColor])

  const onPieceDrop = useCallback(({
    sourceSquare,
    targetSquare
  }: {
    sourceSquare: string
    targetSquare: string | null
  }): boolean => {
    if (status.isTerminal) return false
    if (!targetSquare) return false
    const from = sourceSquare as Square
    const to = targetSquare as Square
    const candidates = chessRef.current.moves({ square: from, verbose: true }) as Move[]
    const candidate = candidates.find((m) => m.to === to)
    if (!candidate) return false

    if (candidate.promotion) {
      setPendingMove({ from, to })
      setPromotionOpen(true)
      return false
    }

    chessRef.current.move({ from, to })
    setLastMove({ from, to })
    clearSelection()
    setPositionFromGame()
    return true
  }, [clearSelection, setPositionFromGame, status.isTerminal])

  const handlePromotion = useCallback((piece: PromotionPiece) => {
    if (!pendingMove) return
    const { from, to } = pendingMove
    chessRef.current.move({ from, to, promotion: piece })
    setLastMove({ from, to })
    setPromotionOpen(false)
    setPendingMove(null)
    clearSelection()
    setPositionFromGame()
  }, [clearSelection, pendingMove, setPositionFromGame])

  const cancelPromotion = useCallback(() => {
    setPromotionOpen(false)
    setPendingMove(null)
  }, [])

  const newGame = useCallback(() => {
    chessRef.current = new Chess()
    setLastMove(null)
    clearSelection()
    setPositionFromGame()
  }, [clearSelection, setPositionFromGame])

  const undoMove = useCallback(() => {
    const undone = chessRef.current.undo()
    if (undone) {
      setLastMove(null)
      clearSelection()
      setPositionFromGame()
    }
  }, [clearSelection, setPositionFromGame])

  const flipBoard = useCallback(() => {
    setOrientation((o) => (o === 'white' ? 'black' : 'white'))
  }, [])

  const copyPGN = useCallback(async () => {
    const pgn = chessRef.current.pgn({ newline: '\n' })
    try {
      await navigator.clipboard.writeText(pgn)
      // no-op toast for now
    } catch {
      // ignore
    }
  }, [])

  const loadLichess = useCallback(async (user?: string) => {
    if (isLoadingLichess) return
    setIsLoadingLichess(true)
    try {
      const uname = (user ?? lichessUsername).trim()
      const key = `lichess:${uname}:index`
      const cached = loadIndexFromLocalStorage(key)
      if (cached) {
        setUserMovesIndex(cached)
        setLichessLoadedGames(0)
        addUserToHistory(uname)
        setUserHistory(getUserHistory())
        return
      }
      const { index, totalGames } = await fetchAndIndexUserGames({ username: uname })
      setUserMovesIndex(index)
      setLichessLoadedGames(totalGames)
      saveIndexToLocalStorage(key, index)
      addUserToHistory(uname)
      setUserHistory(getUserHistory())
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e)
    } finally {
      setIsLoadingLichess(false)
    }
  }, [isLoadingLichess, lichessUsername])

  const deleteHistoryUser = useCallback((u: string) => {
    removeUserFromHistory(u)
    setUserHistory(getUserHistory())
  }, [])

  const useHistoryUser = useCallback((u: string) => {
    setLichessUsername(u)
    setUserMovesIndex(null)
    // сразу загрузим данные выбранного ника
    void loadLichess(u)
  }, [loadLichess])

  const onMouseOverSquare = useCallback(({ square }: { square: string }) => {
    setHoverSquare(square as Square)
  }, [])

  const onMouseOutSquare = useCallback(() => {
    setHoverSquare(null)
  }, [])

  const canDragPiece = useCallback(({ square }: { square: string | null }) => {
    if (!square) return false
    if (status.isTerminal) return false
    const sq = square as Square
    const piece = chessRef.current.get(sq)
    if (!piece) return false
    const color = piece.color === 'w' ? 'white' : 'black'
    return color === turnColor
  }, [status.isTerminal, turnColor])

  const isWhiteTurn = turnColor === 'white'
  const turnLabel = isWhiteTurn ? 'Ход белых' : 'Ход чёрных'
  const noMatchesForPosition = useMemo(() => {
    if (!userMovesIndex) return false
    const bucket = userMovesIndex.getBucket(fen)
    if (!bucket) return true
    return (bucket.userTotal + bucket.oppTotal) === 0
  }, [userMovesIndex, fen])

  return (
    <div className="chess-app">
      <div className="board-panel">
        <div className="panel-header">
          <div className="title">Шахматы</div>
          <div className="status">
            <span className={status.isTerminal ? 'badge badge-terminal' : 'badge'}>
              {status.label || turnLabel}
            </span>
            {userMovesIndex && noMatchesForPosition && (
              <span className="badge" style={{ marginLeft: 8 }}>
                Нет совпадений среди ваших игр для этой позиции
              </span>
            )}
          </div>
        </div>

        <div className="board-row">
          <div className="evalbar-container">
            <EvalBar fen={fen} />
          </div>
          <div className="board-wrapper">
            <Chessboard
              options={{
                id: 'main-board',
                position: fen,
                boardOrientation: orientation,
                pieces: californiaPieces,
                showNotation: true,
                animationDurationInMs: 250,
                showAnimations: true,
                squareStyles: squareStyles,
                lightSquareStyle: { backgroundColor: '#FFFEDD' },
                darkSquareStyle: { backgroundColor: '#86A665' },
                dropSquareStyle: {
                  boxShadow: 'inset 0 0 0 4px rgba(0, 200, 0, 0.65)'
                },
                draggingPieceGhostStyle: {
                  filter: 'drop-shadow(0 12px 20px rgba(0,0,0,.35))'
                },
                boardStyle: {
                  boxShadow:
                    '0 10px 30px rgba(0,0,0,.25), 0 6px 12px rgba(0,0,0,.15)',
                  borderRadius: 16,
                  overflow: 'hidden'
                },
                allowDrawingArrows: true,
                arrows: lichessArrows as any,
                onPieceDrop: ({ sourceSquare, targetSquare }) =>
                  onPieceDrop({ sourceSquare, targetSquare }),
                onSquareClick: ({ square }) => onSquareClick({ square }),
                onPieceClick: ({ square }) => {
                  if (!square) return
                  onSquareClick({ square })
                },
              onPieceDrag: ({ isSparePiece, square }) => {
                if (isSparePiece || !square) return
                if (status.isTerminal) return
                const sq = square as Square
                if (selectedSquare !== sq) {
                  setSelectedSquare(sq)
                  computeLegalTargets(sq)
                }
              },
                onMouseOverSquare: ({ square }) => onMouseOverSquare({ square }),
                onMouseOutSquare: () => onMouseOutSquare(),
                canDragPiece: ({ square }) => canDragPiece({ square })
              }}
            />
          </div>
        </div>

        <div className="controls">
          <button className="btn" onClick={newGame}>Новая партия</button>
          <button className="btn" onClick={undoMove} disabled={historyVerbose.length === 0}>
            Отменить ход
          </button>
          <button className="btn" onClick={flipBoard}>Перевернуть доску</button>
          <button className="btn" onClick={copyPGN} disabled={historyVerbose.length === 0}>
            Скопировать PGN
          </button>
        </div>

        <div className="side-section" style={{ marginTop: 8 }}>
          <div className="section-title">Игроки Lichess</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={lichessUsername}
              onChange={(e) => setLichessUsername(e.target.value)}
              placeholder="Ник на Lichess"
              style={{
                padding: '10px 14px',
                flex: '1',
                fontSize: '1em',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.04)',
                color: 'inherit'
              }}
            />
            <button className="btn" onClick={() => loadLichess()} disabled={isLoadingLichess}>
              {userMovesIndex ? 'Обновить' : isLoadingLichess ? 'Загрузка…' : 'Загрузить'}
            </button>
          </div>
          {userHistory.length > 0 && (
            <ul className="status-list" style={{ marginTop: 8 }}>
              {userHistory.map((u) => (
                <li key={u}>
                  <button className="btn" onClick={() => useHistoryUser(u)}>
                    {u}
                  </button>
                  <button className="btn btn-secondary" onClick={() => deleteHistoryUser(u)}>
                    Удалить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="side-panel">
        <div className="side-section">
          <div className="section-title">Состояние</div>
          <ul className="status-list">
            <li>
              <span>Ход:</span>
              <b>{turnLabel}</b>
            </li>
            <li>
              <span>Игра окончена:</span>
              <b>{status.isTerminal ? 'Да' : 'Нет'}</b>
            </li>
            {status.label && (
              <li>
                <span>Статус:</span>
                <b>{status.label}</b>
              </li>
            )}
            <li>
              <span>Lichess:</span>
              <b>{userMovesIndex ? `${userMovesIndex.size} позиций` : 'не загружено'}</b>
            </li>
            {userMovesIndex && (
              <LichessPositionStats fen={fen} index={userMovesIndex} />
            )}
          </ul>
        </div>

        {/* История ников перенесена в блок "Игроки Lichess" наверху панели */}

        <div className="side-section">
          <div className="section-title">Ходы</div>
          <ol className="moves-list">
            {historyVerbose.map((m, idx) => (
              <li key={`${m.san}-${idx}`}>
                <span className="move-num">{Math.floor(idx / 2) + 1}.</span>
                <span className="move-san">{m.san}</span>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      {promotionOpen && pendingMove && (
        <div className="promotion-backdrop" onClick={cancelPromotion}>
          <div className="promotion-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Выберите фигуру для превращения</div>
            <div className="promotion-grid">
              {(['q', 'r', 'b', 'n'] as PromotionPiece[]).map((p) => (
                <button
                  key={p}
                  className="promo-btn"
                  onClick={() => handlePromotion(p)}
                  aria-label={`Promote to ${p}`}
                >
                  {renderPromotionIcon(p, turnColor)}
                </button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={cancelPromotion}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LichessPositionStats({ fen, index }: { fen: string; index: MoveIndex }) {
  const { win, loss, draw, total } = index.getResultStats(fen)
  if (total === 0) return null
  const w = Math.round((win / total) * 100)
  const l = Math.round((loss / total) * 100)
  const d = Math.round((draw / total) * 100)
  return (
    <li style={{ alignItems: 'flex-start' }}>
      <span className="section-title" style={{ display: 'block', marginBottom: 6 }}>Результат поз.:</span>
      <div style={{ display: 'grid', gap: 2, justifyItems: 'end' }}>
        <div>партий <b>{total}</b></div>
        <div>побед <b>{w}%</b></div>
        <div>ничьих <b>{d}%</b></div>
        <div>поражений <b>{l}%</b></div>
      </div>
    </li>
  )
}

function renderPromotionIcon(piece: PromotionPiece, turn: 'white' | 'black') {
  const fill = turn === 'white' ? '#f2f2f2' : '#1f1f1f'
  const stroke = turn === 'white' ? '#333' : '#ddd'
  const size = 48
  // Простые SVG-иконки, чтобы не зависеть от ассетов
  switch (piece) {
    case 'q':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64">
          <circle cx="12" cy="18" r="5" fill={fill} stroke={stroke} />
          <circle cx="32" cy="12" r="5" fill={fill} stroke={stroke} />
          <circle cx="52" cy="18" r="5" fill={fill} stroke={stroke} />
          <path d="M12 24 L20 44 L44 44 L52 24 L32 20 Z" fill={fill} stroke={stroke} />
          <rect x="18" y="44" width="28" height="6" rx="2" fill={fill} stroke={stroke} />
        </svg>
      )
    case 'r':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64">
          <rect x="16" y="14" width="32" height="10" fill={fill} stroke={stroke} />
          <rect x="20" y="24" width="24" height="20" fill={fill} stroke={stroke} />
          <rect x="16" y="44" width="32" height="6" rx="2" fill={fill} stroke={stroke} />
        </svg>
      )
    case 'b':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64">
          <circle cx="32" cy="16" r="6" fill={fill} stroke={stroke} />
          <path d="M32 22 C18 30, 18 44, 32 44 C46 44, 46 30, 32 22 Z" fill={fill} stroke={stroke} />
          <rect x="20" y="44" width="24" height="6" rx="2" fill={fill} stroke={stroke} />
        </svg>
      )
    case 'n':
      return (
        <svg width={size} height={size} viewBox="0 0 64 64">
          <path d="M16 44 L36 44 L44 36 L44 20 L36 20 L24 32 L24 22 L16 22 Z" fill={fill} stroke={stroke} />
          <rect x="16" y="44" width="32" height="6" rx="2" fill={fill} stroke={stroke} />
        </svg>
      )
  }
}


