// エントリポイント — 各クラスを生成して GameController を起動する

import { ChessEngine } from './engine/engine';
import { ChessRenderer } from './render/renderer';
import { UIController } from './ui/ui';
import { GameController } from './gameController';
import { installTestHook } from './testHook';

const canvas = document.getElementById('render-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('main: #render-canvas canvas element not found');
}

const engine = new ChessEngine();
const renderer = new ChessRenderer(canvas);
const ui = new UIController();
const controller = new GameController(engine, renderer, ui);

// E2E検証用フックを window に公開
installTestHook({ engine, renderer, controller });
