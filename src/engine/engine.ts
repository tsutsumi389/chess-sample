// チェスルールエンジン本体(合成チェスルールを含む)

import type { GameState, GameStatus, Move, Piece, PieceColor, Square } from '../types';
import { isFusionSquare, squareEquals } from '../types';
import { cloneBoard, clonePiece, createInitialBoard, getPiece } from './board';
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

/** 標準チェス + 合成ルールのエンジン */
export class ChessEngine {
  private _state: GameState;

  /** 合成選択待ちのベース駒の位置(awaitingFusion 中のみ非 null) */
  private _fusionBase: Square | null = null;

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
    if (
      this._state.status === 'checkmate' ||
      this._state.status === 'stalemate' ||
      this._state.status === 'awaitingFusion' // 素材選択中は移動操作を受け付けない
    ) {
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
   * 自分の合成マスに未合成の駒が着地し素材候補が1つ以上あるときは、
   * status を 'awaitingFusion' にしてターン交代を tryFuse / skipFuse まで保留する。
   * 違法なら null を返し、状態は変化しない。
   */
  tryMove(from: Square, to: Square): Move | null {
    const move = this.getLegalMoves(from).find((m) => squareEquals(m.to, to));
    if (!move) return null;

    const mover = this._state.turn;
    applyMove(this._state.board, move);
    this._state.lastMove = cloneMove(move);

    // 合成判定: プロモーションは applyMove 内で解決済みのため、
    // ポーンが合成マスに到達した場合は昇格後のクイーンがベース駒になる
    const landed = getPiece(this._state.board, move.to);
    if (
      landed &&
      landed.fusedWith === null && // 合成駒は再合成できない
      isFusionSquare(move.to, mover) && // 自分の合成マスのみ有効
      this.computeFusionCandidates(move.to, mover).length > 0
    ) {
      this._state.status = 'awaitingFusion';
      this._fusionBase = { ...move.to };
      return cloneMove(move);
    }

    this._state.turn = oppositeColor(mover);
    this.updateStatus();

    return cloneMove(move);
  }

  /**
   * 素材候補(自分の駒のうちキング・合成駒・ベース駒自身・
   * 消すと自玉がチェックされる駒を除いたもの)を返す。
   * awaitingFusion 中以外は空配列。
   */
  getFusionCandidates(): Square[] {
    if (this._state.status !== 'awaitingFusion' || !this._fusionBase) return [];
    return this.computeFusionCandidates(this._fusionBase, this._state.turn);
  }

  /** 合成選択待ちのベース駒の位置。awaitingFusion 中以外は null */
  getFusionBaseSquare(): Square | null {
    return this._fusionBase ? { ...this._fusionBase } : null;
  }

  /**
   * 素材駒を選んで合成を実行する。成功なら消滅した素材駒のコピーを返し、
   * ターン交代と status 更新を行う。候補外のマスなどで失敗したら null を返す。
   */
  tryFuse(materialSquare: Square): Piece | null {
    if (this._state.status !== 'awaitingFusion' || !this._fusionBase) return null;
    const isCandidate = this.getFusionCandidates().some((c) =>
      squareEquals(c, materialSquare),
    );
    if (!isCandidate) return null;

    const material = getPiece(this._state.board, materialSquare);
    const base = getPiece(this._state.board, this._fusionBase);
    if (!material || !base) return null;

    // 素材は盤から完全に消滅し、ベース駒が素材の移動能力を吸収する
    this._state.board[materialSquare.rank][materialSquare.file] = null;
    base.fusedWith = material.type;
    this.resolveFusion();

    return clonePiece(material);
  }

  /** 合成をスキップしてターンを終える。awaitingFusion 中でなければ false */
  skipFuse(): boolean {
    if (this._state.status !== 'awaitingFusion') return false;
    this.resolveFusion();
    return true;
  }

  /** 初期状態に戻す */
  reset(): void {
    this._state = ChessEngine.createInitialState();
    this._fusionBase = null;
  }

  /**
   * テスト用フック: 任意の状態を読み込む(ディープコピーされる)。
   * status と winner は盤面と手番から再計算されるため、指定値は無視される
   * (awaitingFusion は再計算できないため復元されない)。
   */
  loadState(state: GameState): void {
    this._state = cloneState(state);
    this._fusionBase = null;
    this.updateStatus();
  }

  /** 合成の解決(実行 or スキップ)後に保留していたターン交代を行う */
  private resolveFusion(): void {
    this._fusionBase = null;
    this._state.turn = oppositeColor(this._state.turn);
    this.updateStatus();
  }

  /** baseSquare の駒をベースとした場合の素材候補を盤上から探す */
  private computeFusionCandidates(baseSquare: Square, color: PieceColor): Square[] {
    const candidates: Square[] = [];
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = this._state.board[rank][file];
        if (!piece || piece.color !== color) continue;
        if (piece.type === 'king') continue; // キングは素材にできない
        if (piece.fusedWith !== null) continue; // 合成駒は素材にできない
        if (squareEquals({ file, rank }, baseSquare)) continue; // ベース駒自身は不可

        // 素材の消滅で自玉がチェックされる(ピンされている)駒は選べない
        const simulated = cloneBoard(this._state.board);
        simulated[rank][file] = null;
        if (isInCheck(simulated, color)) continue;

        candidates.push({ file, rank });
      }
    }
    return candidates;
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
