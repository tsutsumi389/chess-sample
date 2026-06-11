// Babylon.js 3D描画レイヤー — ChessRenderer
// Engine / Scene / カメラ / ライト / 盤面を構築し、盤面状態の3D反映とクリック判定を担う。

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Animation } from '@babylonjs/core/Animations/animation';
import { CubicEase, EasingFunction } from '@babylonjs/core/Animations/easing';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

// 副作用 import: ピッキング(scene.pick)とアニメーション(scene.beginAnimation)を有効化
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Animations/animatable';

import type { Board, PieceColor, PieceType, Square } from '../types';
import { squareEquals } from '../types';
import {
  buildBoard,
  createFusionGlowTiles,
  createHighlightTiles,
  type FusionGlowTiles,
} from './boardBuilder';
import { createPieceMaterial, createPieceMesh } from './pieceMeshes';
import {
  FUSION_CANDIDATE_HEX,
  FUSION_RING_HEX,
  PIECE_BLACK_HEX,
  PIECE_WHITE_HEX,
  SELECT_LIFT_Y,
  isChessMeshMetadata,
  squareToWorld,
  type ChessMeshMetadata,
} from './coords';

const ANIMATION_FPS = 60;

/** 合成演出: 素材粒子がベース駒のマスへ到着するフレーム(これを境に発光→メッシュ差し替え) */
const FUSION_ARRIVAL_FRAME = 24;

/** Piece.id と3Dメッシュの対応エントリ */
interface PieceEntry {
  mesh: Mesh;
  type: PieceType;
  color: PieceColor;
  square: Square;
  /** 合成で吸収した駒種(未合成なら null)。fusedWith の変化で合成演出を発火する */
  fusedWith: PieceType | null;
}

export class ChessRenderer {
  /** 盤マスまたは駒がクリック(ピック)されたら該当マスで発火 */
  public onSquareClicked: ((sq: Square) => void) | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly whiteMaterial: StandardMaterial;
  private readonly blackMaterial: StandardMaterial;
  /** rank * 8 + file でインデックスされるハイライトタイル */
  private readonly highlightTiles: Mesh[];
  /** rank * 8 + file でインデックスされる素材候補ハイライトタイル(金色) */
  private readonly fusionCandidateTiles: Mesh[];
  /** 合成マス(a8/h8/a1/h1)の常時発光タイル */
  private readonly fusionGlow: FusionGlowTiles;
  /** 合成演出(粒子・フラッシュ)用の金色発光マテリアル */
  private readonly fusionEffectMaterial: StandardMaterial;
  private readonly pieces = new Map<number, PieceEntry>();
  private selectedPieceId: number | null = null;
  private readonly handleResize: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.16, 0.17, 0.2, 1);

    // カメラ: 盤を斜め上から見下ろす ArcRotateCamera
    this.camera = new ArcRotateCamera(
      'camera',
      -Math.PI / 4,
      Math.PI / 3,
      20,
      Vector3.Zero(),
      this.scene,
    );
    this.camera.lowerRadiusLimit = 8;
    this.camera.upperRadiusLimit = 40;
    // マウスドラッグで回転、ホイールでズーム
    this.camera.attachControl(canvas, true);

    // ライティング: HemisphericLight + DirectionalLight
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.75;
    const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, -1), this.scene);
    dirLight.intensity = 0.5;

    // 盤面・ハイライトタイル・合成マス発光・駒マテリアル
    buildBoard(this.scene);
    this.highlightTiles = createHighlightTiles(this.scene);
    // 素材候補用は移動ハイライト(緑, y=0.015)と別系統の金色タイルを少し上に重ねる
    this.fusionCandidateTiles = createHighlightTiles(this.scene, {
      namePrefix: 'fusionCandidate',
      hex: FUSION_CANDIDATE_HEX,
      y: 0.02,
    });
    this.fusionGlow = createFusionGlowTiles(this.scene);
    this.whiteMaterial = createPieceMaterial(this.scene, 'whitePieceMat', PIECE_WHITE_HEX);
    this.blackMaterial = createPieceMaterial(this.scene, 'blackPieceMat', PIECE_BLACK_HEX);

    // 合成演出用の金色発光マテリアル(粒子・フラッシュで共有)
    this.fusionEffectMaterial = new StandardMaterial('fusionEffectMat', this.scene);
    this.fusionEffectMaterial.diffuseColor = Color3.FromHexString(FUSION_RING_HEX);
    this.fusionEffectMaterial.emissiveColor = Color3.FromHexString(FUSION_RING_HEX);
    this.fusionEffectMaterial.specularColor = new Color3(0, 0, 0);

    // クリック判定: 盤マス・駒どちらをピックしても該当マスで通知
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERPICK) {
        return;
      }
      const picked = pointerInfo.pickInfo?.pickedMesh;
      if (!picked) {
        return;
      }
      const metadata: unknown = picked.metadata;
      if (!isChessMeshMetadata(metadata)) {
        return;
      }
      this.onSquareClicked?.({ ...metadata.square });
    });

    this.handleResize = (): void => {
      this.engine.resize();
    };
    window.addEventListener('resize', this.handleResize);

    // レンダーループ開始
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  /** 盤面状態を3D表示へ反映する(Piece.id 対応で駒の生成/移動/削除を差分更新) */
  public syncBoard(board: Board): void {
    const aliveIds = new Set<number>();
    // 捕獲された駒(victimId)と、攻撃が来た方向(ノックバック方向)の記録
    const captures = new Map<number, Vector3>();
    // この同期で合成が起きた場合のベース駒のワールド座標(素材駒の粒子の飛来先)
    let fusionTargetWorld: Vector3 | null = null;

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = board[rank][file];
        if (!piece) {
          continue;
        }
        aliveIds.add(piece.id);
        const square: Square = { file, rank };
        const entry = this.pieces.get(piece.id);

        if (!entry) {
          // 新規の駒: メッシュを生成して配置
          this.pieces.set(
            piece.id,
            this.createEntry(piece.id, piece.type, piece.color, square, piece.fusedWith),
          );
          continue;
        }

        const squareChanged = !squareEquals(entry.square, square);

        // 移動先に別の駒が居れば捕獲。攻撃方向(= 進行方向)を記録して崩れ演出に使う
        let isCapture = false;
        if (squareChanged) {
          const victim = this.findEntryAt(square);
          if (victim && victim !== entry) {
            const victimId = this.entryId(victim);
            if (victimId !== null) {
              const direction = squareToWorld(square).subtract(squareToWorld(entry.square));
              direction.y = 0;
              if (direction.lengthSquared() > 0) {
                direction.normalize();
              }
              captures.set(victimId, direction);
              isCapture = true;
            }
          }
        }

        if (entry.type !== piece.type) {
          // プロモーション等で種類が変わった: メッシュを作り直す
          this.scene.stopAnimation(entry.mesh);
          entry.mesh.dispose();
          this.pieces.set(
            piece.id,
            this.createEntry(piece.id, piece.type, piece.color, square, piece.fusedWith),
          );
        } else if (entry.fusedWith !== piece.fusedWith) {
          if (squareChanged) {
            // fusedWith とマスが同時に変わるのは通常の合成フローでは起きない
            // (リスタートで同 id が再採番された場合や loadState 直後など)。
            // 合成演出は再生せず、新しいマスでメッシュを即時再生成して表示を同期する
            this.scene.stopAnimation(entry.mesh);
            entry.mesh.dispose();
            this.pieces.set(
              piece.id,
              this.createEntry(piece.id, piece.type, piece.color, square, piece.fusedWith),
            );
          } else {
            // 合成: 素材の能力を吸収して生まれ変わる(粒子到着後に発光→合成駒メッシュへ差し替え)
            fusionTargetWorld = squareToWorld(square);
            this.playFusionTransform(piece.id, entry, piece.fusedWith);
          }
        } else if (squareChanged) {
          // 既存の駒の移動: アニメーションで移動(捕獲時は対象へ突進)
          entry.square = square;
          this.setMeshSquareMetadata(entry.mesh, square);
          this.animateMove(entry.mesh, squareToWorld(square), isCapture);
        }
      }
    }

    // 盤上から消えた駒を削除。捕獲された駒は崩れ演出、合成の素材駒は粒子化演出を経てから破棄する
    for (const [id, entry] of this.pieces) {
      if (!aliveIds.has(id)) {
        const knockbackDir = captures.get(id);
        if (knockbackDir) {
          this.collapsePiece(entry, knockbackDir);
        } else if (fusionTargetWorld) {
          // 合成と同じ同期で消えた駒 = 素材駒。光の粒子になってベース駒へ飛来する
          this.dissolveFusionMaterial(entry, fusionTargetWorld);
        } else {
          this.scene.stopAnimation(entry.mesh);
          entry.mesh.dispose();
        }
        this.pieces.delete(id);
        if (this.selectedPieceId === id) {
          this.selectedPieceId = null;
        }
      }
    }
  }

  /** 選択駒を Y+0.3 浮かせる(null で解除)。スムーズなアニメーション */
  public setSelected(sq: Square | null): void {
    const nextEntry = sq ? this.findEntryAt(sq) : null;
    const nextId = nextEntry ? this.entryId(nextEntry) : null;

    // 既存の選択を解除して下ろす
    if (this.selectedPieceId !== null && this.selectedPieceId !== nextId) {
      const prev = this.pieces.get(this.selectedPieceId);
      if (prev) {
        this.animateLift(prev.mesh, 0);
      }
      this.selectedPieceId = null;
    }

    // 新しい選択駒を浮かせる
    if (nextEntry && nextId !== null && this.selectedPieceId !== nextId) {
      this.animateLift(nextEntry.mesh, SELECT_LIFT_Y);
      this.selectedPieceId = nextId;
    }
  }

  /** 移動可能マスを半透明色でハイライトする([] でクリア) */
  public setHighlights(squares: Square[]): void {
    for (const tile of this.highlightTiles) {
      tile.isVisible = false;
    }
    for (const sq of squares) {
      const tile = this.highlightTiles[sq.rank * 8 + sq.file];
      if (tile) {
        tile.isVisible = true;
      }
    }
  }

  /** 素材選択モード中の素材候補マスを金色でハイライトする([] でクリア) */
  public setFusionCandidates(squares: Square[]): void {
    for (const tile of this.fusionCandidateTiles) {
      tile.isVisible = false;
    }
    for (const sq of squares) {
      const tile = this.fusionCandidateTiles[sq.rank * 8 + sq.file];
      if (tile) {
        tile.isVisible = true;
      }
    }
  }

  /**
   * 指定した合成マスを強調発光に切り替える([] で通常のうっすら発光に戻す)。
   * 自分の駒が選択され、合成マスが移動先候補になったときに呼ぶ。
   */
  public setFusionSquareEmphasis(squares: Square[]): void {
    this.fusionGlow.setEmphasized(squares);
  }

  /**
   * マスのスクリーン座標(canvas の CSS ピクセル基準)を返す(E2Eテスト用)。
   * マス中心(盤面 y=0)の投影点は手前の駒メッシュに遮蔽される場合があるため
   * (例: 初期カメラ角での e2 と f1 ビショップ)、scene.pick で自己検証し、
   * 実クリックで該当マスに解決される可視点を返す。
   */
  public getSquareScreenPosition(sq: Square): { x: number; y: number } {
    const candidates = this.collectPickCandidates(sq);
    let fallback: { x: number; y: number } | null = null;
    for (const world of candidates) {
      const pos = this.projectToScreen(world);
      fallback ??= pos;
      // 実クリックと同じ座標系(CSS ピクセル)でピックし、該当マスに解決されるか検証
      const picked = this.scene.pick(pos.x, pos.y).pickedMesh;
      const metadata: unknown = picked?.metadata;
      if (isChessMeshMetadata(metadata) && squareEquals(metadata.square, sq)) {
        return pos;
      }
    }
    return fallback ?? this.projectToScreen(squareToWorld(sq));
  }

  /** レンダーループを停止し、全リソースを破棄する */
  public dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.engine.stopRenderLoop();
    this.fusionGlow.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.pieces.clear();
    this.selectedPieceId = null;
  }

  // ----- 内部ヘルパー -----

  /** ワールド座標をスクリーン座標(canvas の CSS ピクセル基準)へ投影する */
  private projectToScreen(world: Vector3): { x: number; y: number } {
    const renderWidth = this.engine.getRenderWidth();
    const renderHeight = this.engine.getRenderHeight();
    const projected = Vector3.Project(
      world,
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(renderWidth, renderHeight),
    );
    // レンダリング解像度から CSS ピクセルへ変換
    const scaleX = renderWidth > 0 ? this.canvas.clientWidth / renderWidth : 1;
    const scaleY = renderHeight > 0 ? this.canvas.clientHeight / renderHeight : 1;
    return { x: projected.x * scaleX, y: projected.y * scaleY };
  }

  /**
   * マスのクリック座標候補(ワールド座標)を優先順に列挙する。
   * マス中心 → マス上の駒メッシュの可視点(バウンディングボックス上部・中心) → タイル内オフセット。
   */
  private collectPickCandidates(sq: Square): Vector3[] {
    const center = squareToWorld(sq);
    const candidates: Vector3[] = [center];

    // マス上に駒がある場合は駒メッシュ上の点も候補にする(駒ピックも同じマスに解決される)
    const entry = this.findEntryAt(sq);
    if (entry) {
      entry.mesh.computeWorldMatrix(true);
      const boundingBox = entry.mesh.getBoundingInfo().boundingBox;
      const c = boundingBox.centerWorld;
      const topY = boundingBox.maximumWorld.y;
      candidates.push(new Vector3(c.x, (c.y + topY) / 2, c.z), c.clone());
    }

    // タイル内の別の可視点(遮蔽されにくい四隅・辺寄りのオフセット)
    const offsets: ReadonlyArray<readonly [number, number]> = [
      [0.3, 0.3],
      [-0.3, 0.3],
      [0.3, -0.3],
      [-0.3, -0.3],
      [0.35, 0],
      [-0.35, 0],
      [0, 0.35],
      [0, -0.35],
    ];
    for (const [dx, dz] of offsets) {
      candidates.push(new Vector3(center.x + dx, 0, center.z + dz));
    }
    return candidates;
  }

  private createEntry(
    id: number,
    type: PieceType,
    color: PieceColor,
    square: Square,
    fusedWith: PieceType | null,
  ): PieceEntry {
    const mesh = createPieceMesh(this.scene, type, `piece_${id}_${color}_${type}`, fusedWith);
    mesh.material = color === 'white' ? this.whiteMaterial : this.blackMaterial;
    const world = squareToWorld(square);
    mesh.position.set(world.x, 0, world.z);
    this.setMeshSquareMetadata(mesh, square);
    return { mesh, type, color, square, fusedWith };
  }

  private setMeshSquareMetadata(mesh: Mesh, square: Square): void {
    const metadata: ChessMeshMetadata = { square };
    mesh.metadata = metadata;
  }

  private findEntryAt(sq: Square): PieceEntry | null {
    for (const entry of this.pieces.values()) {
      if (squareEquals(entry.square, sq)) {
        return entry;
      }
    }
    return null;
  }

  private entryId(target: PieceEntry): number | null {
    for (const [id, entry] of this.pieces) {
      if (entry === target) {
        return id;
      }
    }
    return null;
  }

  /**
   * 駒の移動アニメーション(position 全体を補間)。
   * isCapture=true のときは対象マスへ素早く突進し、わずかに行き過ぎてから着地する。
   */
  private animateMove(mesh: Mesh, target: Vector3, isCapture = false): void {
    this.scene.stopAnimation(mesh);

    if (isCapture) {
      const start = mesh.position.clone();
      const dir = target.subtract(start);
      // 行き過ぎる地点(対象を突き抜けるような突進)
      const overshoot = new Vector3(target.x + dir.x * 0.2, target.y, target.z + dir.z * 0.2);
      const lunge = new Animation(
        'pieceLunge',
        'position',
        ANIMATION_FPS,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      lunge.setKeys([
        { frame: 0, value: start },
        { frame: 8, value: overshoot }, // 突進(行き過ぎ)
        { frame: 14, value: target.clone() }, // 着地で戻す
      ]);
      this.scene.beginDirectAnimation(mesh, [lunge], 0, 14, false);
      return;
    }

    Animation.CreateAndStartAnimation(
      'pieceMove',
      mesh,
      'position',
      ANIMATION_FPS,
      15,
      mesh.position.clone(),
      target,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
  }

  /**
   * 捕獲された駒の「攻撃されて崩れる」演出。
   * 攻撃方向へノックバックしつつ根元を軸に倒れ込み、縮小・消滅する。
   * 衝突の瞬間には破片を飛散させ、アニメーション完了後にメッシュを破棄する。
   */
  private collapsePiece(entry: PieceEntry, direction: Vector3): void {
    const mesh = entry.mesh;
    this.scene.stopAnimation(mesh);
    // 崩れている最中はクリック対象から除外
    mesh.metadata = null;
    mesh.isPickable = false;

    const dir = direction.lengthSquared() > 0 ? direction : new Vector3(0, 0, 1);

    // 攻撃を受けてから崩れ始めるよう、序盤は静止させるイージング
    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEIN);

    const startPos = mesh.position.clone();
    const knockPos = new Vector3(startPos.x + dir.x * 0.5, startPos.y, startPos.z + dir.z * 0.5);
    const sinkPos = new Vector3(knockPos.x, -0.15, knockPos.z);

    // 倒れ込み: ベースを軸に攻撃方向へ約 90° 傾ける
    const tipX = dir.z * (Math.PI / 2);
    const tipZ = -dir.x * (Math.PI / 2);
    const startRot = mesh.rotation.clone();

    const posAnim = new Animation(
      'collapsePos',
      'position',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    posAnim.setKeys([
      { frame: 0, value: startPos },
      { frame: 10, value: startPos }, // 衝突まで静止
      { frame: 22, value: knockPos },
      { frame: 34, value: sinkPos },
    ]);
    posAnim.setEasingFunction(ease);

    const rotAnim = new Animation(
      'collapseRot',
      'rotation',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    rotAnim.setKeys([
      { frame: 0, value: startRot },
      { frame: 10, value: startRot },
      { frame: 26, value: new Vector3(tipX, startRot.y, tipZ) },
      { frame: 34, value: new Vector3(tipX * 1.05, startRot.y, tipZ * 1.05) },
    ]);
    rotAnim.setEasingFunction(ease);

    const scaleAnim = new Animation(
      'collapseScale',
      'scaling',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    const startScale = mesh.scaling.clone();
    scaleAnim.setKeys([
      { frame: 0, value: startScale },
      { frame: 24, value: startScale },
      { frame: 34, value: new Vector3(0.35, 0.12, 0.35) },
    ]);

    const visAnim = new Animation(
      'collapseVis',
      'visibility',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    visAnim.setKeys([
      { frame: 0, value: 1 },
      { frame: 26, value: 1 },
      { frame: 34, value: 0 },
    ]);

    // 衝突の瞬間に破片を飛散させて「崩れる」感を強調
    this.spawnDebris(startPos, mesh.material, dir);

    // visibility は子メッシュ(合成駒の金リング等)へ伝播しないため、子にも同じフェードをかける
    for (const child of mesh.getChildMeshes()) {
      this.scene.beginDirectAnimation(child, [visAnim], 0, 34, false);
    }

    this.scene.beginDirectAnimation(mesh, [posAnim, rotAnim, scaleAnim, visAnim], 0, 34, false, 1, () => {
      mesh.dispose();
    });
  }

  /**
   * 崩れる駒から破片(小さな立方体)を飛散させる。
   * 攻撃方向へ重み付けした外向きの初速で放物線を描き、フェードして自己破棄する。
   */
  private spawnDebris(center: Vector3, material: Mesh['material'], dir: Vector3): void {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const size = 0.06 + Math.random() * 0.1;
      const debris = CreateBox(`debris_${i}_${size.toFixed(3)}`, { size }, this.scene);
      debris.isPickable = false;
      if (material) {
        debris.material = material;
      }
      const startY = 0.2 + Math.random() * 0.8;
      debris.position.set(center.x, startY, center.z);

      // 全方位 + 攻撃方向への偏り
      const angle = Math.random() * Math.PI * 2;
      const spread = 0.35 + Math.random() * 0.55;
      const vx = Math.cos(angle) * spread + dir.x * 0.55;
      const vz = Math.sin(angle) * spread + dir.z * 0.55;
      const up = 0.5 + Math.random() * 0.8;

      const apex = new Vector3(center.x + vx * 0.6, startY + up, center.z + vz * 0.6);
      const ground = new Vector3(center.x + vx, -0.25, center.z + vz);

      const posAnim = new Animation(
        'debrisPos',
        'position',
        ANIMATION_FPS,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      posAnim.setKeys([
        { frame: 0, value: debris.position.clone() },
        { frame: 12, value: debris.position.clone() }, // 衝突まで内部に潜む
        { frame: 24, value: apex },
        { frame: 42, value: ground },
      ]);

      const rotAnim = new Animation(
        'debrisRot',
        'rotation',
        ANIMATION_FPS,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      rotAnim.setKeys([
        { frame: 0, value: Vector3.Zero() },
        {
          frame: 42,
          value: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        },
      ]);

      const visAnim = new Animation(
        'debrisVis',
        'visibility',
        ANIMATION_FPS,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      visAnim.setKeys([
        { frame: 0, value: 0 },
        { frame: 11, value: 0 }, // 衝突するまで不可視
        { frame: 13, value: 1 },
        { frame: 32, value: 1 },
        { frame: 42, value: 0 },
      ]);

      this.scene.beginDirectAnimation(debris, [posAnim, rotAnim, visAnim], 0, 42, false, 1, () => {
        debris.dispose();
      });
    }
  }

  /** 選択時の浮上/解除アニメーション(position.y のみ補間) */
  private animateLift(mesh: Mesh, targetY: number): void {
    this.scene.stopAnimation(mesh);
    Animation.CreateAndStartAnimation(
      'pieceLift',
      mesh,
      'position.y',
      ANIMATION_FPS,
      10,
      mesh.position.y,
      targetY,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
  }

  /**
   * ベース駒の合成演出。素材粒子の到着(FUSION_ARRIVAL_FRAME)まで待機し、
   * 一瞬発光・膨張してから合成駒メッシュ(金リング付き)へ差し替える。
   * 捕獲演出(攻撃→崩れる)と対になる「集まる→生まれ変わる」イメージ。
   */
  private playFusionTransform(id: number, entry: PieceEntry, fusedWith: PieceType | null): void {
    const mesh = entry.mesh;
    this.scene.stopAnimation(mesh);
    // 再同期で演出が重複発動しないよう、先に entry へ反映しておく
    entry.fusedWith = fusedWith;

    // 粒子到着の瞬間にベース駒のマスで金色のフラッシュを出す
    this.spawnFusionFlash(squareToWorld(entry.square), FUSION_ARRIVAL_FRAME);

    // 到着まで静止 → 発光に合わせてわずかに膨張
    const startScale = mesh.scaling.clone();
    const swellScale = startScale.scale(1.2);
    const scaleAnim = new Animation(
      'fusionBaseSwell',
      'scaling',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    scaleAnim.setKeys([
      { frame: 0, value: startScale },
      { frame: FUSION_ARRIVAL_FRAME, value: startScale },
      { frame: FUSION_ARRIVAL_FRAME + 8, value: swellScale },
    ]);

    this.scene.beginDirectAnimation(mesh, [scaleAnim], 0, FUSION_ARRIVAL_FRAME + 8, false, 1, () => {
      // 差し替え前に駒が消えていた(リスタート等)場合は何もしない
      if (this.pieces.get(id) !== entry) {
        return;
      }
      mesh.dispose();
      const reborn = this.createEntry(id, entry.type, entry.color, entry.square, fusedWith);
      this.pieces.set(id, reborn);
      // 生まれ変わりのポップ(小さく現れて等倍へ)
      reborn.mesh.scaling.setAll(0.6);
      Animation.CreateAndStartAnimation(
        'fusionPop',
        reborn.mesh,
        'scaling',
        ANIMATION_FPS,
        12,
        new Vector3(0.6, 0.6, 0.6),
        new Vector3(1, 1, 1),
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
    });
  }

  /**
   * 素材駒の合成演出。光に包まれて浮き上がりながら消滅し、
   * 光の粒子がベース駒のマスへ飛来する。アニメーション完了後にメッシュを破棄する。
   */
  private dissolveFusionMaterial(entry: PieceEntry, target: Vector3): void {
    const mesh = entry.mesh;
    this.scene.stopAnimation(mesh);
    // 消滅中はクリック対象から除外
    mesh.metadata = null;
    mesh.isPickable = false;

    const start = mesh.position.clone();

    // 本体: 浮き上がりつつ縮小・フェードして「粒子になる」表現
    const posAnim = new Animation(
      'fusionMaterialRise',
      'position',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    posAnim.setKeys([
      { frame: 0, value: start },
      { frame: 14, value: new Vector3(start.x, start.y + 0.35, start.z) },
    ]);

    const scaleAnim = new Animation(
      'fusionMaterialShrink',
      'scaling',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    const startScale = mesh.scaling.clone();
    scaleAnim.setKeys([
      { frame: 0, value: startScale },
      { frame: 14, value: startScale.scale(0.5) },
    ]);

    const visAnim = new Animation(
      'fusionMaterialFade',
      'visibility',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    visAnim.setKeys([
      { frame: 0, value: 1 },
      { frame: 5, value: 1 },
      { frame: 14, value: 0 },
    ]);

    // 消え際に素材駒の足元でも小さく光らせる
    this.spawnFusionFlash(start, 0);

    this.scene.beginDirectAnimation(mesh, [posAnim, scaleAnim, visAnim], 0, 14, false, 1, () => {
      mesh.dispose();
    });

    // 光の粒子がベース駒のマスへ飛来する
    this.spawnFusionParticles(start, target);
  }

  /**
   * 素材駒の位置からベース駒のマスへ、光の粒子(小さな金色の球)を弧を描いて飛来させる。
   * 全粒子が FUSION_ARRIVAL_FRAME で到着し、ベース駒の発光と同期する。
   */
  private spawnFusionParticles(from: Vector3, to: Vector3): void {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const diameter = 0.05 + Math.random() * 0.07;
      const particle = CreateSphere(
        `fusionParticle_${i}_${diameter.toFixed(3)}`,
        { diameter, segments: 8 },
        this.scene,
      );
      particle.isPickable = false;
      particle.material = this.fusionEffectMaterial;
      particle.visibility = 0;

      // 素材駒の周囲のランダムな位置から出発
      const startPos = new Vector3(
        from.x + (Math.random() - 0.5) * 0.45,
        0.15 + Math.random() * 0.75,
        from.z + (Math.random() - 0.5) * 0.45,
      );
      particle.position.copyFrom(startPos);

      // 中間点: 出発点と到着点の間を高く持ち上げた弧の頂点
      const apex = new Vector3(
        (startPos.x + to.x) / 2 + (Math.random() - 0.5) * 0.6,
        Math.max(startPos.y, 0.4) + 0.8 + Math.random() * 0.6,
        (startPos.z + to.z) / 2 + (Math.random() - 0.5) * 0.6,
      );
      // 到着点: ベース駒の胴体あたりに収束
      const arrive = new Vector3(
        to.x + (Math.random() - 0.5) * 0.15,
        0.3 + Math.random() * 0.4,
        to.z + (Math.random() - 0.5) * 0.15,
      );

      // 粒子ごとに出発タイミングをずらしつつ、到着は FUSION_ARRIVAL_FRAME に揃える
      // (フレーム 0 のキー重複を避けるため最低 1 フレーム遅らせる)
      const delay = 1 + Math.floor(Math.random() * 5);

      const posAnim = new Animation(
        'fusionParticlePos',
        'position',
        ANIMATION_FPS,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      posAnim.setKeys([
        { frame: 0, value: startPos.clone() },
        { frame: delay, value: startPos.clone() },
        { frame: delay + (FUSION_ARRIVAL_FRAME - delay) * 0.45, value: apex },
        { frame: FUSION_ARRIVAL_FRAME, value: arrive },
      ]);

      const visAnim = new Animation(
        'fusionParticleVis',
        'visibility',
        ANIMATION_FPS,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      visAnim.setKeys([
        { frame: 0, value: 0 },
        { frame: delay, value: 0 },
        { frame: delay + 2, value: 1 },
        { frame: FUSION_ARRIVAL_FRAME - 2, value: 1 },
        { frame: FUSION_ARRIVAL_FRAME + 2, value: 0 },
      ]);

      this.scene.beginDirectAnimation(
        particle,
        [posAnim, visAnim],
        0,
        FUSION_ARRIVAL_FRAME + 2,
        false,
        1,
        () => {
          particle.dispose();
        },
      );
    }
  }

  /**
   * 金色の発光フラッシュ(膨張しながらフェードする球)を出す。
   * delayFrames まで不可視で待機させ、粒子到着の瞬間などに同期発光させる。
   */
  private spawnFusionFlash(center: Vector3, delayFrames: number): void {
    const flash = CreateSphere('fusionFlash', { diameter: 1, segments: 12 }, this.scene);
    flash.isPickable = false;
    flash.material = this.fusionEffectMaterial;
    flash.visibility = 0;
    flash.position.set(center.x, 0.45, center.z);

    const endFrame = delayFrames + 10;

    const scaleAnim = new Animation(
      'fusionFlashScale',
      'scaling',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    // delayFrames = 0 のときフレーム 0 のキーが重複しないよう、待機キーは必要時のみ入れる
    const holdScaleKeys = delayFrames > 0 ? [{ frame: delayFrames, value: new Vector3(0.2, 0.2, 0.2) }] : [];
    scaleAnim.setKeys([
      { frame: 0, value: new Vector3(0.2, 0.2, 0.2) },
      ...holdScaleKeys,
      { frame: endFrame, value: new Vector3(1.4, 1.4, 1.4) },
    ]);

    const visAnim = new Animation(
      'fusionFlashVis',
      'visibility',
      ANIMATION_FPS,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    const holdVisKeys = delayFrames > 0 ? [{ frame: delayFrames, value: 0 }] : [];
    visAnim.setKeys([
      { frame: 0, value: 0 },
      ...holdVisKeys,
      { frame: delayFrames + 1, value: 0.85 },
      { frame: endFrame, value: 0 },
    ]);

    this.scene.beginDirectAnimation(flash, [scaleAnim, visAnim], 0, endFrame, false, 1, () => {
      flash.dispose();
    });
  }
}
