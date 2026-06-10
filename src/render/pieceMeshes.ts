// 駒メッシュの生成(シンプルなプリミティブ形状の組み合わせ)

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { PieceType } from '../types';

/** 駒用 StandardMaterial を作成する */
export function createPieceMaterial(scene: Scene, name: string, hexColor: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hexColor);
  mat.specularColor = new Color3(0.15, 0.15, 0.15);
  return mat;
}

/**
 * 駒の3Dメッシュを生成する。底面が y = 0 に接地する単一メッシュ(マージ済み)を返す。
 * - キング: 背の高い円柱+球
 * - クイーン: 円柱+先端に小さい球
 * - ルーク: 四角柱
 * - ビショップ: 細長い円柱
 * - ナイト: 円柱+斜めに傾いた球(L字的な形)
 * - ポーン: 小さい円柱+球
 */
export function createPieceMesh(scene: Scene, type: PieceType, name: string): Mesh {
  const parts: Mesh[] = [];

  switch (type) {
    case 'king': {
      const body = CreateCylinder(`${name}_body`, { diameter: 0.5, height: 1.3 }, scene);
      body.position.y = 0.65;
      const head = CreateSphere(`${name}_head`, { diameter: 0.45 }, scene);
      head.position.y = 1.45;
      parts.push(body, head);
      break;
    }
    case 'queen': {
      const body = CreateCylinder(`${name}_body`, { diameter: 0.5, height: 1.15 }, scene);
      body.position.y = 0.575;
      const head = CreateSphere(`${name}_head`, { diameter: 0.28 }, scene);
      head.position.y = 1.27;
      parts.push(body, head);
      break;
    }
    case 'rook': {
      const body = CreateBox(`${name}_body`, { width: 0.55, height: 0.85, depth: 0.55 }, scene);
      body.position.y = 0.425;
      parts.push(body);
      break;
    }
    case 'bishop': {
      const body = CreateCylinder(`${name}_body`, { diameter: 0.35, height: 1.1 }, scene);
      body.position.y = 0.55;
      parts.push(body);
      break;
    }
    case 'knight': {
      const body = CreateCylinder(`${name}_body`, { diameter: 0.45, height: 0.7 }, scene);
      body.position.y = 0.35;
      const head = CreateSphere(`${name}_head`, { diameter: 0.5 }, scene);
      head.scaling.set(0.7, 1.2, 0.9);
      head.position.set(0, 0.95, 0.12);
      head.rotation.x = Math.PI / 5;
      parts.push(body, head);
      break;
    }
    case 'pawn': {
      const body = CreateCylinder(`${name}_body`, { diameter: 0.42, height: 0.45 }, scene);
      body.position.y = 0.225;
      const head = CreateSphere(`${name}_head`, { diameter: 0.38 }, scene);
      head.position.y = 0.55;
      parts.push(body, head);
      break;
    }
  }

  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) {
    throw new Error(`駒メッシュの生成に失敗しました: ${name}`);
  }
  merged.name = name;
  return merged;
}
