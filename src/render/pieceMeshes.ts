// 駒メッシュの生成(旋盤形状=CreateLathe による回転体を主体に、実物のスタウントン駒へ寄せる)
//
// 各駒は「縦断面の輪郭(プロファイル)」を Y 軸まわりに回転させて胴体を作る。
// 旋盤では表現できない非軸対称パーツ(ルークの城壁・キングの十字・クイーンの冠・
// ナイトの馬頭)のみ、別途プリミティブを組み合わせて補う。
// いずれも底面が y = 0 に接地する単一メッシュ(マージ済み)を返す。

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateLathe } from '@babylonjs/core/Meshes/Builders/latheBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { PieceType } from '../types';
import { FUSION_AURA_HEX } from './coords';

/** 旋盤の回転分割数(大きいほど滑らか) */
const LATHE_TESSELLATION = 48;

/** 駒用 StandardMaterial を作成する */
export function createPieceMaterial(scene: Scene, name: string, hexColor: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hexColor);
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  mat.specularPower = 32;
  return mat;
}

/**
 * (rx, ry) を半径とする楕円弧上の点列を生成する。
 * fromDeg/toDeg は真上を 0°、真下を 180° とする角度(球頭・卵頭の生成に使う)。
 */
function ellipseArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fromDeg: number,
  toDeg: number,
  segments: number,
): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const deg = fromDeg + (toDeg - fromDeg) * (i / segments);
    const t = (deg * Math.PI) / 180;
    points.push(new Vector3(Math.sin(t) * rx + cx, Math.cos(t) * ry + cy, 0));
  }
  return points;
}

/** プロファイルを Y 軸まわりに回転させた回転体メッシュを作る */
function buildLathe(scene: Scene, name: string, shape: Vector3[]): Mesh {
  return CreateLathe(name, { shape, tessellation: LATHE_TESSELLATION, closed: false }, scene);
}

/**
 * 駒の3Dメッシュを生成する。底面が y = 0 に接地する単一メッシュ(マージ済み)を返す。
 * fusedWith を指定すると合成駒としてシアンの常時オーラ
 * (ベースリング + ジャイロリング + オーラシェル)を付ける
 * (いずれも子メッシュとして付き、親に追従して移動・回転・拡縮する)。
 */
export function createPieceMesh(
  scene: Scene,
  type: PieceType,
  name: string,
  fusedWith: PieceType | null = null,
): Mesh {
  let parts: Mesh[];

  switch (type) {
    case 'pawn':
      parts = buildPawn(scene, name);
      break;
    case 'rook':
      parts = buildRook(scene, name);
      break;
    case 'knight':
      parts = buildKnight(scene, name);
      break;
    case 'bishop':
      parts = buildBishop(scene, name);
      break;
    case 'queen':
      parts = buildQueen(scene, name);
      break;
    case 'king':
      parts = buildKing(scene, name);
      break;
  }

  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) {
    throw new Error(`駒メッシュの生成に失敗しました: ${name}`);
  }
  merged.name = name;

  // 合成駒: シアンの常時オーラ一式を子メッシュとして付与
  if (fusedWith !== null) {
    createFusionAura(scene, name, merged);
  }
  return merged;
}

/** オーラリング用シアン発光マテリアル(シーンごとに1つを共有) */
export function getFusionAuraRingMaterial(scene: Scene): StandardMaterial {
  const existing = scene.getMaterialByName('fusionAuraRingMat');
  if (existing instanceof StandardMaterial) {
    return existing;
  }
  const mat = new StandardMaterial('fusionAuraRingMat', scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = Color3.FromHexString(FUSION_AURA_HEX);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  return mat;
}

/** オーラシェル用 半透明シアンマテリアル(シーンごとに1つを共有) */
export function getFusionAuraShellMaterial(scene: Scene): StandardMaterial {
  const existing = scene.getMaterialByName('fusionAuraShellMat');
  if (existing instanceof StandardMaterial) {
    return existing;
  }
  const mat = new StandardMaterial('fusionAuraShellMat', scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = Color3.FromHexString(FUSION_AURA_HEX);
  mat.specularColor = new Color3(0, 0, 0);
  mat.alpha = 0.22;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  return mat;
}

/** 合成駒の常時オーラ(ベースリング+ジャイロリング+オーラシェル)を子メッシュとして付与 */
function createFusionAura(scene: Scene, name: string, body: Mesh): void {
  const ringMat = getFusionAuraRingMaterial(scene);

  // (1) ベースリング: 台座を取り巻く低速回転リング
  const ring = CreateTorus(
    `${name}_fusionAuraRing`,
    { diameter: 0.78, thickness: 0.06, tessellation: 32 },
    scene,
  );
  ring.position.y = 0.06;
  ring.material = ringMat;
  // ピッキングは親(駒本体)に任せる
  ring.isPickable = false;
  ring.parent = body;

  // (2) 傾斜ジャイロリング: 70°傾けて逆回転。静止画でもシルエットで合成駒と判別できる
  const gyro = CreateTorus(
    `${name}_fusionAuraGyro`,
    { diameter: 0.62, thickness: 0.04, tessellation: 32 },
    scene,
  );
  gyro.position.y = 0.55;
  gyro.rotation.x = (70 * Math.PI) / 180;
  gyro.material = ringMat;
  gyro.isPickable = false;
  gyro.parent = body;

  // (3) オーラシェル: 本体クローンを 1.08 倍にインフレートした呼吸する外殻
  //     doNotCloneChildren=true で自分自身(オーラ)の再帰クローンを防ぐ
  const shell = body.clone(`${name}_fusionAuraShell`, null, true);
  shell.parent = body;
  shell.position.setAll(0);
  shell.rotation.setAll(0);
  shell.scaling.setAll(1.08);
  shell.material = getFusionAuraShellMaterial(scene);
  // clone はピック用 metadata を引き継ぐため必ず消す
  shell.metadata = null;
  shell.isPickable = false;
  // 透明描画順の安定化
  shell.alphaIndex = 1;
}

/** 多くの駒に共通する「広いベース + くびれ」のプロファイル先頭部分 */
function baseProfile(baseRadius: number): Vector3[] {
  return [
    new Vector3(0, 0, 0),
    new Vector3(baseRadius, 0, 0),
    new Vector3(baseRadius, 0.05, 0),
    new Vector3(baseRadius * 0.78, 0.09, 0),
    new Vector3(baseRadius * 0.55, 0.13, 0),
    new Vector3(baseRadius * 0.42, 0.17, 0),
  ];
}

/** ポーン: ベース + 細い胴 + 首輪 + 球頭(高さ ≈ 0.92) */
function buildPawn(scene: Scene, name: string): Mesh[] {
  const shape: Vector3[] = [
    new Vector3(0, 0, 0),
    new Vector3(0.28, 0, 0),
    new Vector3(0.28, 0.05, 0),
    new Vector3(0.19, 0.10, 0),
    new Vector3(0.12, 0.15, 0),
    new Vector3(0.09, 0.34, 0), // 細い胴
    new Vector3(0.15, 0.40, 0), // 首輪(カラー)
    new Vector3(0.15, 0.43, 0),
    new Vector3(0.085, 0.47, 0), // くびれ
    // 球頭(中心 y=0.64, 半径 0.18)
    ...ellipseArc(0, 0.64, 0.18, 0.18, 158, 0, 12),
  ];
  return [buildLathe(scene, `${name}_body`, shape)];
}

/** ルーク: 円筒の胴 + 上部フレア + 城壁(クレネル) */
function buildRook(scene: Scene, name: string): Mesh[] {
  const shape: Vector3[] = [
    ...baseProfile(0.30),
    new Vector3(0.20, 0.20, 0),
    new Vector3(0.19, 0.55, 0), // ほぼ真っ直ぐな胴
    new Vector3(0.22, 0.62, 0), // 上部フレア
    new Vector3(0.27, 0.70, 0),
    new Vector3(0.27, 0.78, 0), // 城壁の外輪(リム)
    new Vector3(0.20, 0.78, 0), // 上面内側(中央が窪む)
    new Vector3(0.18, 0.72, 0),
    new Vector3(0, 0.72, 0),
  ];
  const parts: Mesh[] = [buildLathe(scene, `${name}_body`, shape)];

  // 城壁の歯(クレネル): 上縁に沿って 4 つの切り欠きブロックを配置
  const merlonCount = 6;
  for (let i = 0; i < merlonCount; i++) {
    const angle = (i / merlonCount) * Math.PI * 2;
    const merlon = CreateBox(
      `${name}_merlon${i}`,
      { width: 0.12, height: 0.12, depth: 0.09 },
      scene,
    );
    const r = 0.235;
    merlon.position.set(Math.cos(angle) * r, 0.83, Math.sin(angle) * r);
    merlon.rotation.y = -angle;
    parts.push(merlon);
  }
  return parts;
}

/** ビショップ: ベース + 細い胴 + 首輪 + 卵型のミトラ(司教帽) + 頂玉 */
function buildBishop(scene: Scene, name: string): Mesh[] {
  const shape: Vector3[] = [
    ...baseProfile(0.29),
    new Vector3(0.11, 0.20, 0),
    new Vector3(0.085, 0.52, 0), // 細い胴
    new Vector3(0.16, 0.59, 0), // 首輪
    new Vector3(0.16, 0.63, 0),
    new Vector3(0.08, 0.68, 0), // くびれ
    // 卵型のミトラ(中心 y=0.96, 横半径 0.16 / 縦半径 0.30)
    ...ellipseArc(0, 0.96, 0.16, 0.30, 156, 0, 14),
  ];
  const parts: Mesh[] = [buildLathe(scene, `${name}_body`, shape)];

  // ミトラ頂部の小さな玉
  const finial = CreateSphere(`${name}_finial`, { diameter: 0.11 }, scene);
  finial.position.y = 1.30;
  parts.push(finial);
  return parts;
}

/** ナイト: 旋盤の台座 + プリミティブで構成した馬頭 */
function buildKnight(scene: Scene, name: string): Mesh[] {
  const shape: Vector3[] = [
    ...baseProfile(0.30),
    new Vector3(0.15, 0.20, 0),
    new Vector3(0.14, 0.40, 0),
    new Vector3(0.19, 0.48, 0), // 首輪
    new Vector3(0.19, 0.52, 0),
    new Vector3(0.13, 0.56, 0),
    new Vector3(0, 0.56, 0),
  ];
  const parts: Mesh[] = [buildLathe(scene, `${name}_pedestal`, shape)];

  // 首(台座から立ち上がる円柱状の塊)
  const neck = CreateBox(`${name}_neck`, { width: 0.22, height: 0.34, depth: 0.20 }, scene);
  neck.position.set(0, 0.72, -0.04);
  neck.rotation.x = -Math.PI / 12;
  parts.push(neck);

  // 頭(やや前傾した直方体)
  const head = CreateBox(`${name}_head`, { width: 0.22, height: 0.22, depth: 0.30 }, scene);
  head.position.set(0, 0.95, 0.04);
  head.rotation.x = Math.PI / 9;
  parts.push(head);

  // 鼻面(前方へ突き出す細い直方体)
  const muzzle = CreateBox(`${name}_muzzle`, { width: 0.16, height: 0.14, depth: 0.26 }, scene);
  muzzle.position.set(0, 0.90, 0.22);
  muzzle.rotation.x = Math.PI / 5;
  parts.push(muzzle);

  // 耳(2つの小さな楔)
  for (const dx of [-0.06, 0.06]) {
    const ear = CreateBox(`${name}_ear${dx}`, { width: 0.05, height: 0.12, depth: 0.05 }, scene);
    ear.position.set(dx, 1.12, -0.06);
    ear.rotation.x = -Math.PI / 10;
    parts.push(ear);
  }
  return parts;
}

/** クイーン: 背の高い胴 + 上に開く杯 + 冠の突起 + 頂玉 */
function buildQueen(scene: Scene, name: string): Mesh[] {
  const shape: Vector3[] = [
    ...baseProfile(0.31),
    new Vector3(0.14, 0.20, 0),
    new Vector3(0.10, 0.72, 0), // 細く高い胴
    new Vector3(0.17, 0.80, 0), // 首輪
    new Vector3(0.17, 0.84, 0),
    new Vector3(0.10, 0.88, 0), // くびれ
    new Vector3(0.16, 0.96, 0), // 上に開く杯(クラウン)
    new Vector3(0.24, 1.12, 0),
    new Vector3(0.25, 1.18, 0), // 杯の縁
    new Vector3(0.19, 1.18, 0),
    new Vector3(0.17, 1.10, 0), // 杯の内側(中央が窪む)
    new Vector3(0, 1.10, 0),
  ];
  const parts: Mesh[] = [buildLathe(scene, `${name}_body`, shape)];

  // 冠の突起(縁に沿って環状に並ぶ小球)
  const spikeCount = 8;
  for (let i = 0; i < spikeCount; i++) {
    const angle = (i / spikeCount) * Math.PI * 2;
    const spike = CreateSphere(`${name}_spike${i}`, { diameter: 0.10 }, scene);
    const r = 0.235;
    spike.position.set(Math.cos(angle) * r, 1.22, Math.sin(angle) * r);
    parts.push(spike);
  }
  // 中央頂部の玉
  const finial = CreateSphere(`${name}_finial`, { diameter: 0.16 }, scene);
  finial.position.y = 1.24;
  parts.push(finial);
  return parts;
}

/** キング: クイーンに似た背の高い胴 + 上に開く杯 + 頂部の十字 */
function buildKing(scene: Scene, name: string): Mesh[] {
  const shape: Vector3[] = [
    ...baseProfile(0.32),
    new Vector3(0.15, 0.20, 0),
    new Vector3(0.11, 0.80, 0), // 最も高い胴
    new Vector3(0.18, 0.88, 0), // 首輪
    new Vector3(0.18, 0.92, 0),
    new Vector3(0.11, 0.96, 0), // くびれ
    new Vector3(0.17, 1.04, 0), // 上に開く杯(クラウン)
    new Vector3(0.25, 1.20, 0),
    new Vector3(0.26, 1.26, 0), // 杯の縁
    new Vector3(0.20, 1.26, 0),
    new Vector3(0.18, 1.18, 0), // 杯の内側
    new Vector3(0, 1.18, 0),
  ];
  const parts: Mesh[] = [buildLathe(scene, `${name}_body`, shape)];

  // 頂部の十字(縦棒 + 横棒)
  const crossV = CreateBox(`${name}_crossV`, { width: 0.07, height: 0.34, depth: 0.07 }, scene);
  crossV.position.y = 1.50;
  parts.push(crossV);
  const crossH = CreateBox(`${name}_crossH`, { width: 0.22, height: 0.07, depth: 0.07 }, scene);
  crossH.position.y = 1.50;
  parts.push(crossH);
  return parts;
}
