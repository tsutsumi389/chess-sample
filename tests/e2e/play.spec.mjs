// E2Eプレイ検証 — 実ブラウザ(Chromium)でチェスゲームの主要フローを検証する
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/';
const SCREENSHOT_DIR = 'tests/e2e/screenshots';

/**
 * ページを開き、テストフック(window.__chessTest)の準備とコンソールエラー収集を行う。
 * @returns {Promise<{errors: string[]}>}
 */
async function setupPage(page) {
  const errors = [];
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  await page.goto(BASE_URL);
  await page.waitForFunction(() => window.__chessTest !== undefined);
  // Babylon.js のレンダーループが数フレーム回り、スクリーン投影が安定するのを待つ
  await page.waitForTimeout(500);
  return { errors };
}

/** clickSquare 経由で1手指す(from→to を順にクリック) */
async function playMove(page, from, to) {
  await page.evaluate(
    ([f, t]) => {
      window.__chessTest.clickSquare(f);
      window.__chessTest.clickSquare(t);
    },
    [from, to],
  );
}

/** マス上の駒コード('wP' 等)を取得する */
async function pieceAt(page, alg) {
  return page.evaluate((a) => window.__chessTest.getState().pieceAt(a), alg);
}

/** マス中心のページ座標(canvas の boundingBox を加味)を取得する */
async function squarePagePos(page, alg) {
  const rel = await page.evaluate(
    (a) => window.__chessTest.getSquareScreenPos(a),
    alg,
  );
  const box = await page.locator('#render-canvas').boundingBox();
  if (!box) {
    throw new Error('canvas boundingBox not available');
  }
  return { x: box.x + rel.x, y: box.y + rel.y };
}

/** 診断用: マス中心の投影座標で scene.pick した結果(メッシュ名)を返す */
async function diagnosePickAt(page, alg) {
  return page.evaluate(async (a) => {
    // アプリと同一インスタンスの Engine モジュールを Vite の変換結果から特定する
    const src = await (await fetch('/src/render/renderer.ts')).text();
    const m = src.match(
      /from "(\/node_modules\/\.vite\/deps\/@babylonjs_core_Engines_engine\.js[^"]*)"/,
    );
    if (!m) return 'engine module url not found';
    const { Engine } = await import(m[1]);
    const scene = Engine.Instances[0]?.scenes?.[0];
    if (!scene) return 'scene not found';
    const pos = window.__chessTest.getSquareScreenPos(a);
    const pick = scene.pick(pos.x, pos.y);
    return pick?.pickedMesh?.name ?? 'nothing';
  }, alg);
}

/** 診断用: 表示中のハイライトタイル数を返す */
async function visibleHighlightCount(page) {
  return page.evaluate(async () => {
    const src = await (await fetch('/src/render/renderer.ts')).text();
    const m = src.match(
      /from "(\/node_modules\/\.vite\/deps\/@babylonjs_core_Engines_engine\.js[^"]*)"/,
    );
    if (!m) return -1;
    const { Engine } = await import(m[1]);
    const scene = Engine.Instances[0]?.scenes?.[0];
    if (!scene) return -1;
    return scene.meshes.filter(
      (mesh) => mesh.name.startsWith('highlight_') && mesh.isVisible,
    ).length;
  });
}

test('a: ページロード後 #status-text が "White\'s Turn"', async ({ page }) => {
  const { errors } = await setupPage(page);

  await expect(page.locator('#status-text')).toHaveText("White's Turn");
  expect(await pieceAt(page, 'e2')).toBe('wP');
  expect(await pieceAt(page, 'e1')).toBe('wK');

  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-initial-board.png` });

  // h. コンソールエラーゼロ
  expect(errors).toEqual([]);
});

test('b+c: 実クリック — e2 座標クリックでハイライト、e4 クリックで移動しターン交代', async ({ page }) => {
  const { errors } = await setupPage(page);

  // b. 実クリック検証: getSquareScreenPos('e2') の座標を page.mouse.click する
  const e2Pos = await squarePagePos(page, 'e2');
  await page.mouse.click(e2Pos.x, e2Pos.y);
  await page.waitForTimeout(400);

  // ハイライト確認(e2 ポーン選択なら e3/e4 の2マスが光る)
  const highlights = await visibleHighlightCount(page);
  const pickedMesh = await diagnosePickAt(page, 'e2');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/04-after-e2-real-click.png` });

  // ハイライトで確認できない場合のフォールバック: e4 座標をクリックして移動を検証
  const e4Pos = await squarePagePos(page, 'e4');
  await page.mouse.click(e4Pos.x, e4Pos.y);
  await page.waitForTimeout(400);

  const e4Piece = await pieceAt(page, 'e4');
  expect(
    e4Piece,
    `real click at e2 screen pos did not move pawn to e4. ` +
      `highlight tiles after e2 click: ${highlights}, ` +
      `scene.pick at e2 projected center hits: ${pickedMesh}`,
  ).toBe('wP');
  expect(await pieceAt(page, 'e2')).toBe(null);

  // c. ターン交代: 移動後 "Black's Turn"
  await expect(page.locator('#status-text')).toHaveText("Black's Turn");

  expect(errors).toEqual([]);
});

test('b-control: 実クリック経路の対照検証 — 遮蔽のない b1→c3 は実クリックで動く', async ({ page }) => {
  const { errors } = await setupPage(page);

  // b1 ナイト(マス中心が他の駒に遮蔽されないマス)を実クリック
  const b1Pos = await squarePagePos(page, 'b1');
  await page.mouse.click(b1Pos.x, b1Pos.y);
  await page.waitForTimeout(400);

  // 選択ハイライト(a3/c3 の2マス)が出ること
  const highlights = await visibleHighlightCount(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/05-knight-b1-selected.png` });
  expect(highlights, 'b1 knight selection should highlight a3/c3').toBe(2);

  // c3 を実クリック → ナイトが移動しターン交代
  const c3Pos = await squarePagePos(page, 'c3');
  await page.mouse.click(c3Pos.x, c3Pos.y);
  await page.waitForTimeout(400);

  expect(await pieceAt(page, 'c3')).toBe('wN');
  expect(await pieceAt(page, 'b1')).toBe(null);
  await expect(page.locator('#status-text')).toHaveText("Black's Turn");

  expect(errors).toEqual([]);
});

test('d: 違法手拒否 — 黒番で d7→d3 を試みても状態が変わらない', async ({ page }) => {
  const { errors } = await setupPage(page);

  // 白が e2→e4 を指して黒番にする
  await playMove(page, 'e2', 'e4');
  await expect(page.locator('#status-text')).toHaveText("Black's Turn");

  // 黒番で違法手 d7→d3 を試みる
  await playMove(page, 'd7', 'd3');
  await page.waitForTimeout(300);

  // 状態が変わらないこと(駒は d7 のまま、d3 は空、手番も黒のまま)
  expect(await pieceAt(page, 'd7')).toBe('bP');
  expect(await pieceAt(page, 'd3')).toBe(null);
  const state = await page.evaluate(() => {
    const s = window.__chessTest.getState();
    return { turn: s.turn, status: s.status };
  });
  expect(state.turn).toBe('black');
  expect(state.status).toBe('playing');
  await expect(page.locator('#status-text')).toHaveText("Black's Turn");

  expect(errors).toEqual([]);
});

test('e: 駒取り — e4 d5 exd5 で捕獲が起き盤面に反映される', async ({ page }) => {
  const { errors } = await setupPage(page);

  await playMove(page, 'e2', 'e4');
  await playMove(page, 'd7', 'd5');
  expect(await pieceAt(page, 'd5')).toBe('bP');

  // 白ポーンが黒ポーンを取る(exd5)
  await playMove(page, 'e4', 'd5');
  await page.waitForTimeout(400);

  expect(await pieceAt(page, 'd5')).toBe('wP');
  expect(await pieceAt(page, 'e4')).toBe(null);
  await expect(page.locator('#status-text')).toHaveText("Black's Turn");

  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-capture-exd5.png` });

  expect(errors).toEqual([]);
});

test('f+g: フールズメイト → Checkmate 表示 → リスタートで初期化', async ({ page }) => {
  const { errors } = await setupPage(page);

  // フールズメイト: 白 f2-f3, 黒 e7-e5, 白 g2-g4, 黒 d8-h4#
  await playMove(page, 'f2', 'f3');
  await playMove(page, 'e7', 'e5');
  await playMove(page, 'g2', 'g4');
  await playMove(page, 'd8', 'h4');
  await page.waitForTimeout(500);

  // f. "Checkmate" と "Black Wins" の表示、リスタートボタンの表示
  const statusText = await page.locator('#status-text').textContent();
  expect(statusText).toContain('Checkmate');
  expect(statusText).toContain('Black Wins');
  await expect(page.locator('#restart-button')).toBeVisible();

  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-fools-mate-checkmate.png` });

  // g. リスタートボタンをクリック → "White's Turn" に戻り初期配置
  await page.locator('#restart-button').click();
  await page.waitForTimeout(400);

  await expect(page.locator('#status-text')).toHaveText("White's Turn");
  await expect(page.locator('#restart-button')).toBeHidden();
  expect(await pieceAt(page, 'e2')).toBe('wP');
  expect(await pieceAt(page, 'f2')).toBe('wP');
  expect(await pieceAt(page, 'g2')).toBe('wP');
  expect(await pieceAt(page, 'd8')).toBe('bQ');
  expect(await pieceAt(page, 'e7')).toBe('bP');
  expect(await pieceAt(page, 'h4')).toBe(null);
  expect(await pieceAt(page, 'e1')).toBe('wK');
  expect(await pieceAt(page, 'e8')).toBe('bK');

  expect(errors).toEqual([]);
});
