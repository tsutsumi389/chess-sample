// 8x8 市松模様の盤面とハイライト用タイルの構築

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Square } from '../types';
import { FUSION_SQUARES, squareEquals, squareToAlgebraic } from '../types';
import {
  BOARD_DARK_HEX,
  BOARD_LIGHT_HEX,
  FUSION_GLOW_HEX,
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

/** ハイライトタイル生成のオプション(省略時は移動可能マス用の緑タイル) */
export interface HighlightTileOptions {
  /** メッシュ・マテリアル名のプレフィックス */
  namePrefix?: string;
  /** ハイライト色(16進) */
  hex?: string;
  /** 盤面からの高さ(タイル中心の y 座標) */
  y?: number;
}

/**
 * ハイライト用タイルを 64 マス分作成する(初期状態は非表示)。
 * 既定では移動可能マス用の緑タイル。options で色・高さを変えて
 * 素材候補マス用(金色)などの別系統タイルも作れる。
 * 戻り値は rank * 8 + file でインデックスされる配列。
 */
export function createHighlightTiles(scene: Scene, options: HighlightTileOptions = {}): Mesh[] {
  const namePrefix = options.namePrefix ?? 'highlight';
  const hex = options.hex ?? HIGHLIGHT_HEX;
  const y = options.y ?? 0.015;

  const highlightMat = new StandardMaterial(`${namePrefix}Mat`, scene);
  highlightMat.diffuseColor = Color3.FromHexString(hex);
  highlightMat.emissiveColor = Color3.FromHexString(hex).scale(0.6);
  highlightMat.alpha = 0.45;
  highlightMat.specularColor = new Color3(0, 0, 0);

  const tiles: Mesh[] = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square: Square = { file, rank };
      const tile = CreateBox(
        `${namePrefix}_${file}_${rank}`,
        { width: 0.95, height: 0.02, depth: 0.95 },
        scene,
      );
      const center = squareToWorld(square);
      // 盤面のわずかに上に重ねる(半透明の板で表現)
      tile.position.set(center.x, y, center.z);
      tile.material = highlightMat;
      tile.isPickable = false;
      tile.isVisible = false;
      tiles.push(tile);
    }
  }
  return tiles;
}

/** 合成マス発光タイルの制御ハンドル */
export interface FusionGlowTiles {
  /** 指定した合成マスを強調発光に切り替える([] で全マスを通常のうっすら発光に戻す) */
  setEmphasized(squares: Square[]): void;
  /** 発光タイルとマテリアルを破棄する */
  dispose(): void;
}

/**
 * 合成マス(白: a8/h8、黒: a1/h1)に常時うっすら発光するタイルを敷く。
 * 戻り値の setEmphasized で「移動先候補になった自分の合成マス」を強調発光できる。
 */
export function createFusionGlowTiles(scene: Scene): FusionGlowTiles {
  const glowColor = Color3.FromHexString(FUSION_GLOW_HEX);

  // 通常時: うっすら発光
  const faintMat = new StandardMaterial('fusionGlowFaintMat', scene);
  faintMat.diffuseColor = glowColor;
  faintMat.emissiveColor = glowColor.scale(0.35);
  faintMat.alpha = 0.22;
  faintMat.specularColor = new Color3(0, 0, 0);

  // 強調時: 明るく発光
  const strongMat = new StandardMaterial('fusionGlowStrongMat', scene);
  strongMat.diffuseColor = glowColor;
  strongMat.emissiveColor = glowColor.scale(0.9);
  strongMat.alpha = 0.6;
  strongMat.specularColor = new Color3(0, 0, 0);

  const entries: { square: Square; tile: Mesh }[] = [];
  const allFusionSquares: readonly Square[] = [...FUSION_SQUARES.white, ...FUSION_SQUARES.black];
  for (const square of allFusionSquares) {
    const tile = CreateBox(
      `fusionGlow_${squareToAlgebraic(square)}`,
      { width: 0.95, height: 0.012, depth: 0.95 },
      scene,
    );
    const center = squareToWorld(square);
    // ハイライトタイル(y=0.015)より低く重ね、両者が干渉しないようにする
    tile.position.set(center.x, 0.008, center.z);
    tile.material = faintMat;
    tile.isPickable = false;
    entries.push({ square, tile });
  }

  return {
    setEmphasized(squares: Square[]): void {
      for (const entry of entries) {
        const emphasized = squares.some((sq) => squareEquals(sq, entry.square));
        entry.tile.material = emphasized ? strongMat : faintMat;
      }
    },
    dispose(): void {
      for (const entry of entries) {
        entry.tile.dispose();
      }
      faintMat.dispose();
      strongMat.dispose();
    },
  };
}
