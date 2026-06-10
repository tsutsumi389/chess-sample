// 指し手生成・攻撃判定・指し手適用

import type { Board, Move, Piece, PieceColor, Square } from '../types';
import { cloneBoard, clonePiece, findKing, getPiece, isInside } from './board';

/** ルーク(およびクイーン)の直線方向 */
const ORTHOGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** ビショップ(およびクイーン)の斜め方向 */
const DIAGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** ナイトのL字移動オフセット */
const KNIGHT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

/** キングの周囲8マスのオフセット */
const KING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  ...ORTHOGONAL_DIRS,
  ...DIAGONAL_DIRS,
];

/** 相手色を返す */
export function oppositeColor(color: PieceColor): PieceColor {
  return color === 'white' ? 'black' : 'white';
}

/** target のマスが by 色の駒に攻撃されているか */
export function isSquareAttacked(board: Board, target: Square, by: PieceColor): boolean {
  // ポーンの斜め攻撃(白は上方向、黒は下方向に攻撃する)
  const pawnDir = by === 'white' ? 1 : -1;
  for (const df of [-1, 1]) {
    const file = target.file + df;
    const rank = target.rank - pawnDir;
    if (isInside(file, rank)) {
      const piece = board[rank][file];
      if (piece && piece.color === by && piece.type === 'pawn') return true;
    }
  }

  // ナイト
  for (const [df, dr] of KNIGHT_OFFSETS) {
    const file = target.file + df;
    const rank = target.rank + dr;
    if (isInside(file, rank)) {
      const piece = board[rank][file];
      if (piece && piece.color === by && piece.type === 'knight') return true;
    }
  }

  // キング(隣接マス)
  for (const [df, dr] of KING_OFFSETS) {
    const file = target.file + df;
    const rank = target.rank + dr;
    if (isInside(file, rank)) {
      const piece = board[rank][file];
      if (piece && piece.color === by && piece.type === 'king') return true;
    }
  }

  // 直線(ルーク・クイーン)
  if (isAttackedBySlider(board, target, by, ORTHOGONAL_DIRS, 'rook')) return true;
  // 斜め(ビショップ・クイーン)
  if (isAttackedBySlider(board, target, by, DIAGONAL_DIRS, 'bishop')) return true;

  return false;
}

function isAttackedBySlider(
  board: Board,
  target: Square,
  by: PieceColor,
  dirs: ReadonlyArray<readonly [number, number]>,
  sliderType: 'rook' | 'bishop',
): boolean {
  for (const [df, dr] of dirs) {
    let file = target.file + df;
    let rank = target.rank + dr;
    while (isInside(file, rank)) {
      const piece = board[rank][file];
      if (piece) {
        if (piece.color === by && (piece.type === sliderType || piece.type === 'queen')) {
          return true;
        }
        break;
      }
      file += df;
      rank += dr;
    }
  }
  return false;
}

/** 指定色のキングがチェックされているか */
export function isInCheck(board: Board, color: PieceColor): boolean {
  const kingSquare = findKing(board, color);
  return isSquareAttacked(board, kingSquare, oppositeColor(color));
}

/** Move オブジェクトを生成する(省略項目はデフォルト値) */
function makeMove(
  from: Square,
  to: Square,
  captured: Piece | null,
  options: Partial<Pick<Move, 'castling' | 'isEnPassant' | 'promotion'>> = {},
): Move {
  return {
    from: { ...from },
    to: { ...to },
    captured: captured ? clonePiece(captured) : null,
    castling: options.castling ?? null,
    isEnPassant: options.isEnPassant ?? false,
    promotion: options.promotion ?? null,
  };
}

/**
 * from の駒の疑似合法手(自玉のチェック放置は考慮しない)を生成する。
 * キャスリングの「通過マスが攻撃されていない」条件はここで検証する。
 */
export function generatePseudoLegalMoves(
  board: Board,
  from: Square,
  lastMove: Move | null,
): Move[] {
  const piece = getPiece(board, from);
  if (!piece) return [];

  switch (piece.type) {
    case 'pawn':
      return generatePawnMoves(board, from, piece, lastMove);
    case 'knight':
      return generateStepMoves(board, from, piece, KNIGHT_OFFSETS);
    case 'bishop':
      return generateSlidingMoves(board, from, piece, DIAGONAL_DIRS);
    case 'rook':
      return generateSlidingMoves(board, from, piece, ORTHOGONAL_DIRS);
    case 'queen':
      return generateSlidingMoves(board, from, piece, KING_OFFSETS);
    case 'king':
      return [
        ...generateStepMoves(board, from, piece, KING_OFFSETS),
        ...generateCastlingMoves(board, from, piece),
      ];
  }
}

/** ナイト・キング用: オフセット先へ1歩だけ動く手 */
function generateStepMoves(
  board: Board,
  from: Square,
  piece: Piece,
  offsets: ReadonlyArray<readonly [number, number]>,
): Move[] {
  const moves: Move[] = [];
  for (const [df, dr] of offsets) {
    const to: Square = { file: from.file + df, rank: from.rank + dr };
    if (!isInside(to.file, to.rank)) continue;
    const target = board[to.rank][to.file];
    if (target && target.color === piece.color) continue;
    moves.push(makeMove(from, to, target));
  }
  return moves;
}

/** ルーク・ビショップ・クイーン用: 障害物まで直進する手 */
function generateSlidingMoves(
  board: Board,
  from: Square,
  piece: Piece,
  dirs: ReadonlyArray<readonly [number, number]>,
): Move[] {
  const moves: Move[] = [];
  for (const [df, dr] of dirs) {
    let file = from.file + df;
    let rank = from.rank + dr;
    while (isInside(file, rank)) {
      const target = board[rank][file];
      if (target) {
        if (target.color !== piece.color) {
          moves.push(makeMove(from, { file, rank }, target));
        }
        break;
      }
      moves.push(makeMove(from, { file, rank }, null));
      file += df;
      rank += dr;
    }
  }
  return moves;
}

/** ポーンの手(前進・初手2マス・斜め取り・アンパッサン・プロモーション) */
function generatePawnMoves(
  board: Board,
  from: Square,
  piece: Piece,
  lastMove: Move | null,
): Move[] {
  const moves: Move[] = [];
  const dir = piece.color === 'white' ? 1 : -1;
  const startRank = piece.color === 'white' ? 1 : 6;
  const promotionRank = piece.color === 'white' ? 7 : 0;

  const pushMove = (to: Square, captured: Piece | null, isEnPassant = false): void => {
    // 最終段到達で自動的にクイーン昇格
    const promotion = to.rank === promotionRank ? 'queen' : null;
    moves.push(makeMove(from, to, captured, { promotion, isEnPassant }));
  };

  // 前進1マス
  const oneAhead: Square = { file: from.file, rank: from.rank + dir };
  if (isInside(oneAhead.file, oneAhead.rank) && !board[oneAhead.rank][oneAhead.file]) {
    pushMove(oneAhead, null);

    // 初手のみ前進2マス(間も空いていること)
    const twoAhead: Square = { file: from.file, rank: from.rank + dir * 2 };
    if (from.rank === startRank && !board[twoAhead.rank][twoAhead.file]) {
      pushMove(twoAhead, null);
    }
  }

  // 斜め取り
  for (const df of [-1, 1]) {
    const to: Square = { file: from.file + df, rank: from.rank + dir };
    if (!isInside(to.file, to.rank)) continue;
    const target = board[to.rank][to.file];
    if (target && target.color !== piece.color) {
      pushMove(to, target);
    }
  }

  // アンパッサン: 直前の手が隣接ファイルの敵ポーンの2マス前進であること
  if (lastMove) {
    const movedPiece = getPiece(board, lastMove.to);
    if (
      movedPiece &&
      movedPiece.type === 'pawn' &&
      movedPiece.color !== piece.color &&
      Math.abs(lastMove.to.rank - lastMove.from.rank) === 2 &&
      lastMove.to.rank === from.rank &&
      Math.abs(lastMove.to.file - from.file) === 1
    ) {
      const to: Square = { file: lastMove.to.file, rank: from.rank + dir };
      pushMove(to, movedPiece, true);
    }
  }

  return moves;
}

/** キャスリングの手を生成する(成立条件をすべて検証) */
function generateCastlingMoves(board: Board, from: Square, king: Piece): Move[] {
  const moves: Move[] = [];
  if (king.hasMoved) return moves;

  const rank = from.rank;
  const enemy = oppositeColor(king.color);

  // キングが現在チェックされている場合は不可
  if (isSquareAttacked(board, from, enemy)) return moves;

  // [キャスリング種別, ルークの初期ファイル, 間に空きが必要なファイル, キングが通過・到達するファイル]
  const candidates: ReadonlyArray<
    readonly ['kingside' | 'queenside', number, readonly number[], readonly number[]]
  > = [
    ['kingside', 7, [5, 6], [5, 6]],
    ['queenside', 0, [1, 2, 3], [3, 2]],
  ];

  for (const [side, rookFile, emptyFiles, kingPathFiles] of candidates) {
    const rook = board[rank][rookFile];
    if (!rook || rook.type !== 'rook' || rook.color !== king.color || rook.hasMoved) continue;

    // キングとルークの間がすべて空いていること
    if (emptyFiles.some((file) => board[rank][file] !== null)) continue;

    // キングの通過マス・到達マスが攻撃されていないこと
    if (kingPathFiles.some((file) => isSquareAttacked(board, { file, rank }, enemy))) continue;

    const kingToFile = side === 'kingside' ? 6 : 2;
    moves.push(makeMove(from, { file: kingToFile, rank }, null, { castling: side }));
  }

  return moves;
}

/** 指し手を盤面に適用する(board を直接変更する) */
export function applyMove(board: Board, move: Move): void {
  const piece = board[move.from.rank][move.from.file];
  if (!piece) {
    throw new Error('移動元に駒がありません');
  }

  board[move.from.rank][move.from.file] = null;
  board[move.to.rank][move.to.file] = piece;
  piece.hasMoved = true;

  // アンパッサン: 取られるポーンは移動先の真後ろ(移動元と同じ段)にいる
  if (move.isEnPassant) {
    board[move.from.rank][move.to.file] = null;
  }

  // キャスリング: ルークも同時に移動する
  if (move.castling) {
    const rookFromFile = move.castling === 'kingside' ? 7 : 0;
    const rookToFile = move.castling === 'kingside' ? 5 : 3;
    const rook = board[move.from.rank][rookFromFile];
    if (rook) {
      board[move.from.rank][rookFromFile] = null;
      board[move.from.rank][rookToFile] = rook;
      rook.hasMoved = true;
    }
  }

  // プロモーション(自動でクイーン)
  if (move.promotion) {
    piece.type = move.promotion;
  }
}

/**
 * from の駒の合法手を生成する。
 * 疑似合法手のうち、指した後に自玉がチェックされる手を除外する。
 */
export function generateLegalMoves(
  board: Board,
  from: Square,
  turn: PieceColor,
  lastMove: Move | null,
): Move[] {
  const piece = getPiece(board, from);
  if (!piece || piece.color !== turn) return [];

  return generatePseudoLegalMoves(board, from, lastMove).filter((move) => {
    const simulated = cloneBoard(board);
    applyMove(simulated, move);
    return !isInCheck(simulated, turn);
  });
}

/** 指定色に合法手が1つでも存在するか */
export function hasAnyLegalMove(
  board: Board,
  color: PieceColor,
  lastMove: Move | null,
): boolean {
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (!piece || piece.color !== color) continue;
      if (generateLegalMoves(board, { file, rank }, color, lastMove).length > 0) {
        return true;
      }
    }
  }
  return false;
}
