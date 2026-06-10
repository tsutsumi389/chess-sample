// UIオーバーレイ制御 — ターン・状態表示とリスタートボタンの管理
import type { GameState, PieceColor } from '../types';

/** 駒色の表示名("White" / "Black") */
function colorLabel(color: PieceColor): string {
  return color === 'white' ? 'White' : 'Black';
}

export class UIController {
  private readonly statusText: HTMLElement;
  private readonly restartButton: HTMLButtonElement;

  /** リスタートボタン押下で発火するコールバック */
  onRestart: (() => void) | null = null;

  constructor() {
    const statusText = document.getElementById('status-text');
    if (!statusText) {
      throw new Error('UIController: #status-text element not found');
    }

    const restartButton = document.getElementById('restart-button');
    if (!(restartButton instanceof HTMLButtonElement)) {
      throw new Error('UIController: #restart-button element not found');
    }

    this.statusText = statusText;
    this.restartButton = restartButton;

    this.restartButton.addEventListener('click', () => {
      if (this.onRestart) {
        this.onRestart();
      }
    });
  }

  /** 状態に応じて表示を更新する */
  update(state: GameState): void {
    this.statusText.textContent = this.buildStatusText(state);

    // ゲーム終了時(checkmate/stalemate)のみリスタートボタンを表示
    const isGameOver =
      state.status === 'checkmate' || state.status === 'stalemate';
    this.restartButton.hidden = !isGameOver;
  }

  private buildStatusText(state: GameState): string {
    switch (state.status) {
      case 'playing':
        return `${colorLabel(state.turn)}'s Turn`;
      case 'check':
        return `${colorLabel(state.turn)}'s Turn — Check!`;
      case 'checkmate': {
        // winner が null になることは契約上ないが、型安全のためフォールバックする
        const winner = state.winner ?? (state.turn === 'white' ? 'black' : 'white');
        return `Checkmate! ${colorLabel(winner)} Wins`;
      }
      case 'stalemate':
        return 'Stalemate — Draw';
    }
  }
}
