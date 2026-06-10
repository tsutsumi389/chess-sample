// 3D描画レイヤー共通: 座標変換・配色・メッシュメタデータ定義

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Square } from '../types';

/** 選択中の駒を浮かせる高さ(Y軸 +0.3) */
export const SELECT_LIFT_Y = 0.3;

/** 盤マスの厚み */
export const TILE_THICKNESS = 0.2;

/** 白駒の色 #F0D9B5(クリーム色) */
export const PIECE_WHITE_HEX = '#F0D9B5';

/** 黒駒の色 #B58863(茶色) */
export const PIECE_BLACK_HEX = '#B58863';

/** 盤の明マス(駒色と区別できるよう明度を上げ彩度を下げた系統色) */
export const BOARD_LIGHT_HEX = '#EDE0C8';

/** 盤の暗マス(駒色と区別できるよう暗めにした系統色) */
export const BOARD_DARK_HEX = '#9E6B4A';

/** ハイライト色(移動可能マス) */
export const HIGHLIGHT_HEX = '#4CAF50';

/**
 * マス(file, rank)の中心ワールド座標。
 * x = file - 3.5, z = rank - 3.5(1マス = 1ユニット、盤面上面が y = 0)
 */
export function squareToWorld(sq: Square): Vector3 {
  return new Vector3(sq.file - 3.5, 0, sq.rank - 3.5);
}

/** 盤マス・駒メッシュが metadata として保持する盤座標情報 */
export interface ChessMeshMetadata {
  square: Square;
}

/** metadata が ChessMeshMetadata かどうかの実行時ガード */
export function isChessMeshMetadata(value: unknown): value is ChessMeshMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const square = (value as { square?: unknown }).square;
  return (
    typeof square === 'object' &&
    square !== null &&
    typeof (square as { file?: unknown }).file === 'number' &&
    typeof (square as { rank?: unknown }).rank === 'number'
  );
}
