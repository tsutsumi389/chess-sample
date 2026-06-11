// 共有型定義 — 全モジュールが従う契約。変更する場合は全モジュールの整合を取ること。

export type PieceColor = 'white' | 'black';

export type PieceType =
  | 'king'
  | 'queen'
  | 'rook'
  | 'bishop'
  | 'knight'
  | 'pawn';

/** 盤上の座標。file: 0-7 (a-h), rank: 0-7 (1-8) */
export interface Square {
  file: number;
  rank: number;
}

export interface Piece {
  id: number;
  type: PieceType;
  color: PieceColor;
  hasMoved: boolean;
  /** 合成で吸収した駒種。未合成なら null */
  fusedWith: PieceType | null;
}

/** 8x8 盤面。board[rank][file]。空マスは null */
export type Board = (Piece | null)[][];

export interface Move {
  from: Square;
  to: Square;
  /** 取った駒(アンパッサン含む)。なければ null */
  captured: Piece | null;
  /** キャスリング種別 */
  castling: 'kingside' | 'queenside' | null;
  /** アンパッサンによる捕獲か */
  isEnPassant: boolean;
  /** プロモーション先(自動でクイーン) */
  promotion: PieceType | null;
}

export type GameStatus =
  | 'playing'
  | 'check'
  | 'checkmate'
  | 'stalemate'
  | 'awaitingFusion'; // 合成マス着地後、素材選択待ち

export interface GameState {
  board: Board;
  turn: PieceColor;
  status: GameStatus;
  /** 直前の手(アンパッサン判定に使用)。なければ null */
  lastMove: Move | null;
  /** チェックメイト時の勝者 */
  winner: PieceColor | null;
}

export function squareEquals(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}

/** "e4" のような代数表記へ(デバッグ・テスト用) */
export function squareToAlgebraic(sq: Square): string {
  return String.fromCharCode(97 + sq.file) + String(sq.rank + 1);
}

export function algebraicToSquare(s: string): Square {
  return { file: s.charCodeAt(0) - 97, rank: Number(s[1]) - 1 };
}

/** 各プレイヤーの合成マス(相手陣の最奥2隅)。白: a8/h8、黒: a1/h1 */
export const FUSION_SQUARES: Record<PieceColor, readonly Square[]> = {
  white: [
    { file: 0, rank: 7 }, // a8
    { file: 7, rank: 7 }, // h8
  ],
  black: [
    { file: 0, rank: 0 }, // a1
    { file: 7, rank: 0 }, // h1
  ],
};

/** square が forColor の合成マスかどうか */
export function isFusionSquare(square: Square, forColor: PieceColor): boolean {
  return FUSION_SQUARES[forColor].some((fs) => squareEquals(fs, square));
}
