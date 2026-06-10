// E2E検証用テストフック — window.__chessTest を公開する

import type { Piece, PieceType } from './types';
import { algebraicToSquare } from './types';
import type { ChessEngine } from './engine/engine';
import type { ChessRenderer } from './render/renderer';
import type { GameController } from './gameController';

/** getState() が返すスナップショット */
export interface ChessTestStateSnapshot {
  turn: string;
  status: string;
  winner: string | null;
  /** 'e4' 形式のマスにある駒を 'wP' 'bK' 形式で返す(空なら null) */
  pieceAt(alg: string): string | null;
}

/** window.__chessTest の型 */
export interface ChessTestApi {
  /** 'e2' 形式のマスを、実クリックと同一の処理経路でクリックする */
  clickSquare(alg: string): void;
  getState(): ChessTestStateSnapshot;
  /** マス中心のスクリーン座標(canvas の CSS ピクセル基準) */
  getSquareScreenPos(alg: string): { x: number; y: number };
  /** #status-text の現在のテキスト */
  getStatusText(): string;
  /** ゲームをリスタートする */
  reset(): void;
}

declare global {
  interface Window {
    __chessTest: ChessTestApi;
  }
}

/** PieceType → 1文字表記('wP' 'bK' などの2文字目) */
const PIECE_LETTERS: Record<PieceType, string> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
  pawn: 'P',
};

/** Piece を 'wP' 'bK' 形式の文字列にする */
function pieceCode(piece: Piece): string {
  return (piece.color === 'white' ? 'w' : 'b') + PIECE_LETTERS[piece.type];
}

interface TestHookDeps {
  engine: ChessEngine;
  renderer: ChessRenderer;
  controller: GameController;
}

/** window.__chessTest を設置する */
export function installTestHook(deps: TestHookDeps): void {
  const { engine, renderer, controller } = deps;

  window.__chessTest = {
    clickSquare(alg: string): void {
      // 実クリックと同一の処理経路(GameController のクリックハンドラ)を通す
      controller.handleSquareClick(algebraicToSquare(alg));
    },

    getState(): ChessTestStateSnapshot {
      const state = engine.state;
      return {
        turn: state.turn,
        status: state.status,
        winner: state.winner,
        pieceAt(alg: string): string | null {
          const sq = algebraicToSquare(alg);
          const piece = state.board[sq.rank]?.[sq.file] ?? null;
          return piece ? pieceCode(piece) : null;
        },
      };
    },

    getSquareScreenPos(alg: string): { x: number; y: number } {
      return renderer.getSquareScreenPosition(algebraicToSquare(alg));
    },

    getStatusText(): string {
      return document.getElementById('status-text')?.textContent ?? '';
    },

    reset(): void {
      controller.restart();
    },
  };
}
