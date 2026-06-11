// E2E検証用テストフック — window.__chessTest を公開する

import type { Piece, PieceType } from './types';
import { algebraicToSquare, squareToAlgebraic } from './types';
import type { ChessEngine } from './engine/engine';
import type { ChessRenderer } from './render/renderer';
import type { GameController } from './gameController';

/** getState() が返すスナップショット */
export interface ChessTestStateSnapshot {
  turn: string;
  status: string;
  winner: string | null;
  /** 素材候補マス('a1' 形式)の一覧。awaitingFusion 中以外は空配列 */
  fusionCandidates: string[];
  /** 合成待ちベース駒のマス('a8' 形式)。awaitingFusion 中以外は null */
  fusionBaseSquare: string | null;
  /** 'e4' 形式のマスにある駒を 'wP' 'bK' 形式で返す(空なら null) */
  pieceAt(alg: string): string | null;
  /** そのマスの駒が合成で吸収した駒種('R' 等の1文字)。未合成・駒なしは null */
  fusedWithAt(alg: string): string | null;
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
  /** #fusion-notice の現在のテキスト(非表示なら空文字) */
  getFusionNoticeText(): string;
  /** 合成をスキップしてターンを終える(UIのスキップボタンと同一経路) */
  skipFusion(): void;
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
      const fusionBase = engine.getFusionBaseSquare();
      return {
        turn: state.turn,
        status: state.status,
        winner: state.winner,
        fusionCandidates: engine
          .getFusionCandidates()
          .map((c) => squareToAlgebraic(c)),
        fusionBaseSquare: fusionBase ? squareToAlgebraic(fusionBase) : null,
        pieceAt(alg: string): string | null {
          const sq = algebraicToSquare(alg);
          const piece = state.board[sq.rank]?.[sq.file] ?? null;
          return piece ? pieceCode(piece) : null;
        },
        fusedWithAt(alg: string): string | null {
          const sq = algebraicToSquare(alg);
          const piece = state.board[sq.rank]?.[sq.file] ?? null;
          return piece?.fusedWith ? PIECE_LETTERS[piece.fusedWith] : null;
        },
      };
    },

    getSquareScreenPos(alg: string): { x: number; y: number } {
      return renderer.getSquareScreenPosition(algebraicToSquare(alg));
    },

    getStatusText(): string {
      return document.getElementById('status-text')?.textContent ?? '';
    },

    getFusionNoticeText(): string {
      const notice = document.getElementById('fusion-notice');
      if (!notice || notice.hidden) return '';
      return notice.textContent ?? '';
    },

    skipFusion(): void {
      // UIのスキップボタンと同一の処理経路(GameController.skipFusion)を通す
      controller.skipFusion();
    },

    reset(): void {
      controller.restart();
    },
  };
}
