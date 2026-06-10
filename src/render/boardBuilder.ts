// 8x8 市松模様の盤面とハイライト用タイルの構築

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Square } from '../types';
import {
  BOARD_DARK_HEX,
  BOARD_LIGHT_HEX,
  HIGHLIGHT_HEX,
  TILE_THICKNESS,
  squareToWorld,
  type ChessMeshMetadata,
} from './coords';

/**
 * 8x8 の市松模様の盤面を構築する。
 * 各マスには盤座標をメタデータとして持たせ、クリック判定に使う。
 */
export function buildBoard(scene: Scene): void {
  const lightMat = new StandardMaterial('boardLightMat', scene);
  lightMat.diffuseColor = Color3.FromHexString(BOARD_LIGHT_HEX);
  lightMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const darkMat = new StandardMaterial('boardDarkMat', scene);
  darkMat.diffuseColor = Color3.FromHexString(BOARD_DARK_HEX);
  darkMat.specularColor = new Color3(0.05, 0.05, 0.05);

  // 盤の外枠(土台)
  const frameMat = new StandardMaterial('boardFrameMat', scene);
  frameMat.diffuseColor = Color3.FromHexString('#5C4033');
  frameMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const frame = CreateBox('boardFrame', { width: 9.2, height: TILE_THICKNESS, depth: 9.2 }, scene);
  frame.position.y = -TILE_THICKNESS;
  frame.material = frameMat;
  frame.isPickable = false;

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square: Square = { file, rank };
      const tile = CreateBox(
        `tile_${file}_${rank}`,
        { width: 1, height: TILE_THICKNESS, depth: 1 },
        scene,
      );
      const center = squareToWorld(square);
      tile.position.set(center.x, -TILE_THICKNESS / 2, center.z);
      // a1(file:0, rank:0)が暗マスになる標準配色
      tile.material = (file + rank) % 2 === 0 ? darkMat : lightMat;
      const metadata: ChessMeshMetadata = { square };
      tile.metadata = metadata;
    }
  }
}

/**
 * 移動可能マスのハイライト用タイルを 64 マス分作成する(初期状態は非表示)。
 * 戻り値は rank * 8 + file でインデックスされる配列。
 */
export function createHighlightTiles(scene: Scene): Mesh[] {
  const highlightMat = new StandardMaterial('highlightMat', scene);
  highlightMat.diffuseColor = Color3.FromHexString(HIGHLIGHT_HEX);
  highlightMat.emissiveColor = Color3.FromHexString(HIGHLIGHT_HEX).scale(0.6);
  highlightMat.alpha = 0.45;
  highlightMat.specularColor = new Color3(0, 0, 0);

  const tiles: Mesh[] = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square: Square = { file, rank };
      const tile = CreateBox(
        `highlight_${file}_${rank}`,
        { width: 0.95, height: 0.02, depth: 0.95 },
        scene,
      );
      const center = squareToWorld(square);
      // 盤面のわずかに上に重ねる(半透明の板で表現)
      tile.position.set(center.x, 0.015, center.z);
      tile.material = highlightMat;
      tile.isPickable = false;
      tile.isVisible = false;
      tiles.push(tile);
    }
  }
  return tiles;
}
