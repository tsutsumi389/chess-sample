// ゲーム統合制御 — ChessEngine / ChessRenderer / UIController を接続する

import type { Move, Square } from './types';
import { isFusionSquare, squareEquals } from './types';
import type { ChessEngine } from './engine/engine';
import type { ChessRenderer } from './render/renderer';
import type { UIController } from './ui/ui';

/** エンジン・描画・UI を仲介し、クリック操作とゲーム進行を制御する */
export class GameController {
  private readonly engine: ChessEngine;
  private readonly renderer: ChessRenderer;
  private readonly ui: UIController;

  /** 選択中の駒のマス(未選択なら null) */
  private selected: Square | null = null;
  /** 選択中の駒の合法手 */
  private legalMoves: Move[] = [];

  constructor(engine: ChessEngine, renderer: ChessRenderer, ui: UIController) {
    this.engine = engine;
    this.renderer = renderer;
    this.ui = ui;

    this.renderer.onSquareClicked = (sq): void => {
      this.handleSquareClick(sq);
    };
    this.ui.onRestart = (): void => {
      this.restart();
    };
    this.ui.onSkipFusion = (): void => {
      this.skipFusion();
    };

    this.refresh();
  }

  /**
   * マスクリック時の処理(実クリック・テストフック共通の経路)。
   * - 自分の駒クリック → 選択(浮上 + 合法手ハイライト)
   * - 選択中に合法マスクリック → 移動を実行
   * - 選択中に自分の別駒クリック → 選択変更
   * - それ以外 → 選択解除
   * - 素材選択モード(awaitingFusion)中 → 素材候補のクリックのみ受け付ける
   */
  handleSquareClick(sq: Square): void {
    const state = this.engine.state;

    // ゲーム終了(checkmate/stalemate)後は駒操作不可
    if (state.status === 'checkmate' || state.status === 'stalemate') {
      return;
    }

    // 素材選択モード中は素材候補のクリックのみ有効(駒の移動などは受け付けない)
    if (state.status === 'awaitingFusion') {
      this.handleFusionMaterialClick(sq);
      return;
    }

    // 選択中に合法マスをクリック → 移動
    if (this.selected && this.legalMoves.some((m) => squareEquals(m.to, sq))) {
      const moved = this.engine.tryMove(this.selected, sq);
      this.clearSelection();
      if (moved) {
        this.refresh();
      }
      return;
    }

    const piece = state.board[sq.rank]?.[sq.file] ?? null;

    // 自分(手番側)の駒をクリック → 選択 / 選択変更
    if (piece && piece.color === state.turn) {
      if (this.selected && squareEquals(this.selected, sq)) {
        // 選択中の駒を再クリック → 選択解除
        this.clearSelection();
        return;
      }
      this.selected = { ...sq };
      this.legalMoves = this.engine.getLegalMoves(sq);
      this.renderer.setSelected(sq);
      this.renderer.setHighlights(this.legalMoves.map((m) => ({ ...m.to })));
      // 未合成の駒なら、移動先候補に含まれる自分の合成マスを強調発光する
      // (合成駒は再合成できないため強調しない)
      this.renderer.setFusionSquareEmphasis(
        piece.fusedWith === null
          ? this.legalMoves
              .map((m) => ({ ...m.to }))
              .filter((to) => isFusionSquare(to, state.turn))
          : [],
      );
      return;
    }

    // それ以外(空マス・相手の駒など) → 選択解除
    this.clearSelection();
  }

  /** 合成をスキップしてターンを終える(UIのスキップボタン・テストフックから呼ぶ) */
  skipFusion(): void {
    if (this.engine.skipFuse()) {
      this.refresh();
    }
  }

  /** ゲームをリスタートする(初期局面に戻し、全表示をリセット) */
  restart(): void {
    this.engine.reset();
    this.clearSelection();
    this.refresh();
  }

  /**
   * 素材選択モード中のクリック処理。
   * 素材候補なら合成を実行して演出・通知を出し、それ以外のクリックは無視する
   * (素材選択モードを継続する)。
   */
  private handleFusionMaterialClick(sq: Square): void {
    const baseSquare = this.engine.getFusionBaseSquare();
    if (!baseSquare) return;

    const state = this.engine.state;
    const mover = state.turn;
    // 合成通知用にベース駒の駒種を tryFuse 前に記録する(ポーンは昇格済みクイーン)
    const base = state.board[baseSquare.rank]?.[baseSquare.file] ?? null;

    const material = this.engine.tryFuse(sq);
    if (!material) {
      // 候補外(キング・合成駒・ピン駒・空マスなど)のクリックは無視する
      return;
    }

    // refresh 内の syncBoard が合成演出(粒子飛来→金リング付きメッシュ差替)を自動再生する
    this.refresh();
    if (base) {
      this.ui.notifyFusion(mover, base.type, material.type);
    }
  }

  /** 選択状態とハイライトをすべて解除する */
  private clearSelection(): void {
    this.selected = null;
    this.legalMoves = [];
    this.renderer.setSelected(null);
    this.renderer.setHighlights([]);
    this.renderer.setFusionSquareEmphasis([]);
  }

  /** エンジンの現在状態を 3D 表示と UI に反映する */
  private refresh(): void {
    const state = this.engine.state;
    this.renderer.syncBoard(state.board);
    // 素材候補ハイライト(awaitingFusion 中以外は空配列が返るため自動的にクリアされる)
    this.renderer.setFusionCandidates(this.engine.getFusionCandidates());
    this.ui.update(state);
  }
}
