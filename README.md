# chess-sample

Babylon.js + TypeScript + Vite で動作する、ブラウザ向け3Dチェスゲーム。
標準チェスのルールに完全準拠した2人ローカル対戦が可能です。

## 特徴

- **3D描画**: Babylon.js による8×8の市松模様ボードと駒メッシュ
- **カメラ操作**: ArcRotateCamera でマウスドラッグ回転・ホイールズーム(radius 8〜40)
- **標準チェスルール完全実装**:
  - 全6種の駒の移動ルール
  - チェック / チェックメイト / ステールメイト判定
  - キャスリング(両側)
  - アンパッサン
  - プロモーション(最終段で自動的にクイーンへ昇格)
- **UI**: ターン表示・チェック警告・終了メッセージ・リスタートボタン
- 選択中の駒を浮かせるアニメーション、移動可能マスのハイライト表示

## 必要環境

- Node.js 18 以上
- モダンブラウザ(Chrome / Firefox / Safari)

## セットアップ

```bash
npm install
```

## 使い方

開発サーバーを起動:

```bash
npm run dev
```

表示された URL(デフォルト http://localhost:5173)をブラウザで開きます。

### 操作方法

- **駒を選択**: 自分の駒をクリック(移動可能マスがハイライト表示される)
- **移動**: ハイライトされたマスをクリック
- **選択変更**: 選択中に別の自分の駒をクリック
- **カメラ**: マウスドラッグで回転、ホイールでズーム
- 白番からスタートし、交互に手番が進みます

## スクリプト

| コマンド | 内容 |
|----------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 型チェック + 本番ビルド |
| `npm run preview` | ビルド成果物のプレビュー |
| `npm test` | ユニットテスト実行(vitest) |
| `npm run typecheck` | 型チェックのみ |

## テスト

```bash
# ルールエンジンのユニットテスト
npm test

# 実ブラウザE2Eテスト(Playwright)
npx playwright test
```

## プロジェクト構成

```
src/
├── types.ts            共有型定義(全モジュールの契約)
├── engine/             チェスルールエンジン
│   ├── board.ts        盤面の生成・操作
│   ├── moveGeneration.ts  各駒の合法手生成
│   └── engine.ts       ChessEngine(状態管理・勝敗判定)
├── render/             Babylon.js 描画レイヤー
│   ├── boardBuilder.ts ボード構築
│   ├── pieceMeshes.ts  駒メッシュ生成
│   ├── coords.ts       盤座標 ⇔ 3D座標変換
│   └── renderer.ts     ChessRenderer(シーン・カメラ・ピック)
├── ui/ui.ts            UIController(オーバーレイ制御)
├── gameController.ts   エンジン・描画・UIの統合
├── testHook.ts         E2E検証用フック
└── main.ts             エントリポイント

tests/
├── engine.test.ts      ルールエンジンのユニットテスト
└── e2e/play.spec.mjs   実ブラウザでのプレイ検証
```

## 技術スタック

| 項目 | 内容 |
|------|------|
| 3Dエンジン | Babylon.js v8 |
| 言語 | TypeScript(strict モード) |
| ビルドツール | Vite |
| テスト | Vitest / Playwright |
