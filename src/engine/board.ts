// 盤面の生成・複製・参照のためのヘルパー群

import type { Board, Piece, PieceColor, PieceType, Square } from '../types';

/** 1段目(白)・8段目(黒)の駒の並び */
const BACK_RANK: PieceType[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
];

/** 標準初期配置の盤面を生成する */
export function createInitialBoard(): Board {
  const board: Board = [];
  for (let rank = 0; rank < 8; rank++) {
    const row: (Piece | null)[] = [];
    for (let file = 0; file < 8; file++) {
      row.push(null);
    }
    board.push(row);
  }

  let nextId = 1;
  const place = (file: number, rank: number, type: PieceType, color: PieceColor): void => {
    board[rank][file] = { id: nextId++, type, color, hasMoved: false };
  };

  for (let file = 0; file < 8; file++) {
    place(file, 0, BACK_RANK[file], 'white');
    place(file, 1, 'pawn', 'white');
    place(file, 6, 'pawn', 'black');
    place(file, 7, BACK_RANK[file], 'black');
  }

  return board;
}

/** 駒の複製 */
export function clonePiece(piece: Piece): Piece {
  return { ...piece };
}

/** 盤面のディープコピー */
export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((piece) => (piece ? clonePiece(piece) : null)));
}

/** 座標が盤内かどうか */
export function isInside(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

/** 指定マスの駒を取得(盤外は null) */
export function getPiece(board: Board, sq: Square): Piece | null {
  if (!isInside(sq.file, sq.rank)) return null;
  return board[sq.rank][sq.file];
}

/** 指定色のキングの位置を探す */
export function findKing(board: Board, color: PieceColor): Square {
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (piece && piece.type === 'king' && piece.color === color) {
        return { file, rank };
      }
    }
  }
  throw new Error(`${color} のキングが盤上に存在しません`);
}
