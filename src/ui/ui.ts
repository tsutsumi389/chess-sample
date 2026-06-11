// UIオーバーレイ制御 — ターン・状態表示、リスタートボタン、素材選択オーバーレイ、合成通知の管理
import type { GameState, PieceColor, PieceType } from '../types';

/** 駒色の表示名("White" / "Black") */
function colorLabel(color: PieceColor): string {
  return color === 'white' ? 'White' : 'Black';
}

/** 駒種の表示名(合成通知 "White fused Knight + Rook!" に使用) */
const PIECE_TYPE_LABELS: Record<PieceType, string> = {
  king: 'King',
  queen: 'Queen',
  rook: 'Rook',
  bishop: 'Bishop',
  knight: 'Knight',
  pawn: 'Pawn',
};

/** 合成通知を自動で消すまでの時間(ミリ秒) */
const FUSION_NOTICE_DURATION_MS = 2500;

export class UIController {
  private readonly statusText: HTMLElement;
  private readonly restartButton: HTMLButtonElement;
  /** 素材選択オーバーレイ(awaitingFusion 中のみ表示) */
  private readonly fusionOverlay: HTMLDivElement;
  /** 合成発生の通知バナー */
  private readonly fusionNotice: HTMLDivElement;
  /** 合成通知の自動非表示タイマー */
  private fusionNoticeTimer: number | null = null;

  /** リスタートボタン押下で発火するコールバック */
  onRestart: (() => void) | null = null;
  /** スキップボタン押下で発火するコールバック(合成せずターン終了) */
  onSkipFusion: (() => void) | null = null;

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

    // 素材選択オーバーレイ・合成通知は index.html を変更せず動的に生成する
    const overlayRoot = this.statusText.parentElement ?? document.body;

    this.fusionNotice = document.createElement('div');
    this.fusionNotice.id = 'fusion-notice';
    this.fusionNotice.hidden = true;

    this.fusionOverlay = document.createElement('div');
    this.fusionOverlay.id = 'fusion-overlay';
    this.fusionOverlay.hidden = true;

    const fusionPrompt = document.createElement('div');
    fusionPrompt.id = 'fusion-prompt';
    fusionPrompt.textContent = 'Select a piece to fuse (or skip)';

    const skipButton = document.createElement('button');
    skipButton.id = 'skip-fusion-button';
    skipButton.textContent = 'Skip';
    skipButton.addEventListener('click', () => {
      if (this.onSkipFusion) {
        this.onSkipFusion();
      }
    });

    this.fusionOverlay.append(fusionPrompt, skipButton);
    overlayRoot.append(this.fusionNotice, this.fusionOverlay);
  }

  /** 状態に応じて表示を更新する */
  update(state: GameState): void {
    this.statusText.textContent = this.buildStatusText(state);

    // ゲーム終了時(checkmate/stalemate)のみリスタートボタンを表示
    const isGameOver =
      state.status === 'checkmate' || state.status === 'stalemate';
    this.restartButton.hidden = !isGameOver;

    // 素材選択中のみオーバーレイ(スキップボタン)を表示
    this.fusionOverlay.hidden = state.status !== 'awaitingFusion';
  }

  /** 合成発生を上部オーバーレイに通知する(例: "White fused Knight + Rook!") */
  notifyFusion(
    color: PieceColor,
    baseType: PieceType,
    materialType: PieceType,
  ): void {
    this.fusionNotice.textContent = `${colorLabel(color)} fused ${PIECE_TYPE_LABELS[baseType]} + ${PIECE_TYPE_LABELS[materialType]}!`;
    this.fusionNotice.hidden = false;

    // 連続合成時はタイマーを張り直して表示時間をリセットする
    if (this.fusionNoticeTimer !== null) {
      window.clearTimeout(this.fusionNoticeTimer);
    }
    this.fusionNoticeTimer = window.setTimeout(() => {
      this.fusionNotice.hidden = true;
      this.fusionNoticeTimer = null;
    }, FUSION_NOTICE_DURATION_MS);
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
      case 'awaitingFusion':
        return `${colorLabel(state.turn)}: Select a piece to fuse (or skip)`;
    }
  }
}
