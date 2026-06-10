// Babylon.js 3D描画レイヤー — ChessRenderer
// Engine / Scene / カメラ / ライト / 盤面を構築し、盤面状態の3D反映とクリック判定を担う。

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Animation } from '@babylonjs/core/Animations/animation';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

// 副作用 import: ピッキング(scene.pick)とアニメーション(scene.beginAnimation)を有効化
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Animations/animatable';

import type { Board, PieceColor, PieceType, Square } from '../types';
import { squareEquals } from '../types';
import { buildBoard, createHighlightTiles } from './boardBuilder';
import { createPieceMaterial, createPieceMesh } from './pieceMeshes';
import {
  PIECE_BLACK_HEX,
  PIECE_WHITE_HEX,
  SELECT_LIFT_Y,
  isChessMeshMetadata,
  squareToWorld,
  type ChessMeshMetadata,
} from './coords';

const ANIMATION_FPS = 60;

/** Piece.id と3Dメッシュの対応エントリ */
interface PieceEntry {
  mesh: Mesh;
  type: PieceType;
  color: PieceColor;
  square: Square;
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

    // 盤面・ハイライトタイル・駒マテリアル
    buildBoard(this.scene);
    this.highlightTiles = createHighlightTiles(this.scene);
    this.whiteMaterial = createPieceMaterial(this.scene, 'whitePieceMat', PIECE_WHITE_HEX);
    this.blackMaterial = createPieceMaterial(this.scene, 'blackPieceMat', PIECE_BLACK_HEX);

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
          this.pieces.set(piece.id, this.createEntry(piece.id, piece.type, piece.color, square));
        } else if (entry.type !== piece.type) {
          // プロモーション等で種類が変わった: メッシュを作り直す
          this.scene.stopAnimation(entry.mesh);
          entry.mesh.dispose();
          this.pieces.set(piece.id, this.createEntry(piece.id, piece.type, piece.color, square));
        } else if (!squareEquals(entry.square, square)) {
          // 既存の駒の移動: アニメーションで移動
          entry.square = square;
          this.setMeshSquareMetadata(entry.mesh, square);
          this.animateMove(entry.mesh, squareToWorld(square));
        }
      }
    }

    // 盤上から消えた駒(捕獲済み)を削除
    for (const [id, entry] of this.pieces) {
      if (!aliveIds.has(id)) {
        this.scene.stopAnimation(entry.mesh);
        entry.mesh.dispose();
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
  ): PieceEntry {
    const mesh = createPieceMesh(this.scene, type, `piece_${id}_${color}_${type}`);
    mesh.material = color === 'white' ? this.whiteMaterial : this.blackMaterial;
    const world = squareToWorld(square);
    mesh.position.set(world.x, 0, world.z);
    this.setMeshSquareMetadata(mesh, square);
    return { mesh, type, color, square };
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

  /** 駒の移動アニメーション(position 全体を補間) */
  private animateMove(mesh: Mesh, target: Vector3): void {
    this.scene.stopAnimation(mesh);
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
}
