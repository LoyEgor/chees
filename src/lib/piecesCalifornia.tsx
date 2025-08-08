import type { PieceRenderObject } from 'react-chessboard'

const LICHESS_BASE = 'https://lichess1.org/assets/piece/california'

function ImgPiece({ code }: { code: string }) {
  return (
    <img
      src={`${LICHESS_BASE}/${code}.svg`}
      alt={code}
      draggable={false}
      style={{ width: '100%', height: '100%', userSelect: 'none', pointerEvents: 'none' }}
    />
  )
}

export const californiaPieces: PieceRenderObject = {
  wP: () => <ImgPiece code="wP" />, wR: () => <ImgPiece code="wR" />, wN: () => <ImgPiece code="wN" />, wB: () => <ImgPiece code="wB" />, wQ: () => <ImgPiece code="wQ" />, wK: () => <ImgPiece code="wK" />,
  bP: () => <ImgPiece code="bP" />, bR: () => <ImgPiece code="bR" />, bN: () => <ImgPiece code="bN" />, bB: () => <ImgPiece code="bB" />, bQ: () => <ImgPiece code="bQ" />, bK: () => <ImgPiece code="bK" />
}


