// チェスルールエンジン本体

import type { GameState, GameStatus, Move, PieceColor, Square } from '../types';
import { squareEquals } from '../types';
import { cloneBoard, clonePiece, createInitialBoard } from './board';
import {
  applyMove,
  generateLegalMoves,
  hasAnyLegalMove,
  isInCheck,
  oppositeColor,
} from './moveGeneration';

/** Move のディープコピー */
function cloneMove(move: Move): Move {
  return {
    from: { ...move.from },
    to: { ...move.to },
    captured: move.captured ? clonePiece(move.captured) : null,
    castling: move.castling,
    isEnPassant: move.isEnPassant,
    promotion: move.promotion,
  };
}

/** GameState のディープコピー */
function cloneState(state: GameState): GameState {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    status: state.status,
    lastMove: state.lastMove ? cloneMove(state.lastMove) : null,
    winner: state.winner,
  };
}

/** 標準チェスのルールエンジン */
export class ChessEngine {
  private _state: GameState;

  /** 標準初期配置・白番で開始する */
  constructor() {
    this._state = ChessEngine.createInitialState();
  }

  /** 現在の状態(ディープコピーを返すため、呼び出し側で変更しても内部状態は壊れない) */
  get state(): GameState {
    return cloneState(this._state);
  }

  /**
   * そのマスの駒の合法手を返す(チェック放置になる手は除外)。
   * 駒がない場合・相手番の駒の場合は空配列を返す。
   */
  getLegalMoves(from: Square): Move[] {
    if (this._state.status === 'checkmate' || this._state.status === 'stalemate') {
      return [];
    }
    return generateLegalMoves(
      this._state.board,
      from,
      this._state.turn,
      this._state.lastMove,
    );
  }

  /**
   * 合法なら指し手を実行して Move を返し、ターン交代と status 更新を行う。
   * 違法なら null を返し、状態は変化しない。
   */
  tryMove(from: Square, to: Square): Move | null {
    const move = this.getLegalMoves(from).find((m) => squareEquals(m.to, to));
    if (!move) return null;

    applyMove(this._state.board, move);
    this._state.lastMove = cloneMove(move);
    this._state.turn = oppositeColor(this._state.turn);
    this.updateStatus();

    return cloneMove(move);
  }

  /** 初期状態に戻す */
  reset(): void {
    this._state = ChessEngine.createInitialState();
  }

  /**
   * テスト用フック: 任意の状態を読み込む(ディープコピーされる)。
   * status と winner は盤面と手番から再計算されるため、指定値は無視される。
   */
  loadState(state: GameState): void {
    this._state = cloneState(state);
    this.updateStatus();
  }

  /** 現在の手番側から見た status / winner を再計算する */
  private updateStatus(): void {
    const { board, turn, lastMove } = this._state;
    const inCheck = isInCheck(board, turn);
    const canMove = hasAnyLegalMove(board, turn, lastMove);

    let status: GameStatus;
    let winner: PieceColor | null = null;

    if (canMove) {
      status = inCheck ? 'check' : 'playing';
    } else if (inCheck) {
      status = 'checkmate';
      winner = oppositeColor(turn);
    } else {
      status = 'stalemate';
    }

    this._state.status = status;
    this._state.winner = winner;
  }

  private static createInitialState(): GameState {
    return {
      board: createInitialBoard(),
      turn: 'white',
      status: 'playing',
      lastMove: null,
      winner: null,
    };
  }
}
