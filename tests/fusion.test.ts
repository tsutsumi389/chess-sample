// 合成チェス(駒の合成ルール)のユニットテスト — docs/spec-fusion.md の「テスト観点」を網羅する

import { describe, expect, it } from 'vitest';
import type {
  Board,
  GameState,
  Piece,
  PieceColor,
  PieceType,
} from '../src/types';
import {
  algebraicToSquare,
  isFusionSquare,
  squareToAlgebraic,
} from '../src/types';
import { ChessEngine } from '../src/engine/engine';

/** 代数表記のショートカット */
const sq = algebraicToSquare;

/** 空の8x8盤面を生成する */
function emptyBoard(): Board {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));
}

interface PlacementSpec {
  square: string;
  type: PieceType;
  color: PieceColor;
  hasMoved?: boolean;
  /** 合成済み駒を直接配置する場合に指定 */
  fusedWith?: PieceType;
}

/** テスト用の任意局面を組み立てる */
function buildState(placements: PlacementSpec[], turn: PieceColor): GameState {
  const board = emptyBoard();
  placements.forEach((p, index) => {
    const { file, rank } = sq(p.square);
    const piece: Piece = {
      id: index + 1,
      type: p.type,
      color: p.color,
      hasMoved: p.hasMoved ?? false,
      fusedWith: p.fusedWith ?? null,
    };
    board[rank][file] = piece;
  });
  return { board, turn, status: 'playing', lastMove: null, winner: null };
}

/** 指定局面を読み込んだエンジンを作る */
function engineWith(placements: PlacementSpec[], turn: PieceColor): ChessEngine {
  const engine = new ChessEngine();
  engine.loadState(buildState(placements, turn));
  return engine;
}

/** 盤上の駒を取得する */
function pieceAt(engine: ChessEngine, square: string): Piece | null {
  const { file, rank } = sq(square);
  return engine.state.board[rank][file];
}

/** 合法手の移動先を代数表記の配列にする */
function destinations(engine: ChessEngine, from: string): string[] {
  return engine
    .getLegalMoves(sq(from))
    .map((m) => squareToAlgebraic(m.to))
    .sort();
}

/** 素材候補を代数表記の配列にする */
function candidateSquares(engine: ChessEngine): string[] {
  return engine
    .getFusionCandidates()
    .map((c) => squareToAlgebraic(c))
    .sort();
}

/** 代数表記で指す(失敗したらテストを落とす) */
function mustMove(engine: ChessEngine, from: string, to: string): void {
  const move = engine.tryMove(sq(from), sq(to));
  expect(move, `${from}-${to} は合法手のはず`).not.toBeNull();
}

describe('合成マスの定義', () => {
  it('白の合成マスは a8/h8、黒の合成マスは a1/h1', () => {
    expect(isFusionSquare(sq('a8'), 'white')).toBe(true);
    expect(isFusionSquare(sq('h8'), 'white')).toBe(true);
    expect(isFusionSquare(sq('a1'), 'black')).toBe(true);
    expect(isFusionSquare(sq('h1'), 'black')).toBe(true);
    // 相手の合成マス・中央マスは該当しない
    expect(isFusionSquare(sq('a1'), 'white')).toBe(false);
    expect(isFusionSquare(sq('a8'), 'black')).toBe(false);
    expect(isFusionSquare(sq('e4'), 'white')).toBe(false);
  });
});

describe('合成の発動条件', () => {
  it('自分の合成マスに着地すると awaitingFusion になりターン交代しない', () => {
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'h2', type: 'pawn', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');

    const state = engine.state;
    expect(state.status).toBe('awaitingFusion');
    expect(state.turn).toBe('white'); // ターン交代は保留される
    expect(candidateSquares(engine)).toEqual(['h2']);
  });

  it('捕獲によって合成マスに着地しても発動する', () => {
    const engine = engineWith(
      [
        { square: 'a5', type: 'rook', color: 'white' },
        { square: 'a8', type: 'rook', color: 'black' },
        { square: 'h2', type: 'pawn', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    const move = engine.tryMove(sq('a5'), sq('a8'));
    expect(move).not.toBeNull();
    expect(move?.captured).toMatchObject({ type: 'rook', color: 'black' });
    expect(engine.state.status).toBe('awaitingFusion');
    expect(engine.state.turn).toBe('white');
  });

  it('相手の合成マスに着地しても何も起きない', () => {
    // a1 は黒の合成マス。白駒が止まっても通常どおりターン交代する
    const engine = engineWith(
      [
        { square: 'b1', type: 'rook', color: 'white' },
        { square: 'h2', type: 'pawn', color: 'white' },
        { square: 'e4', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b1', 'a1');
    expect(engine.state.status).toBe('playing');
    expect(engine.state.turn).toBe('black');
  });

  it('黒は a1 に着地すると awaitingFusion になる', () => {
    const engine = engineWith(
      [
        { square: 'b1', type: 'rook', color: 'black' },
        { square: 'h7', type: 'pawn', color: 'black' },
        { square: 'e8', type: 'king', color: 'black' },
        { square: 'h4', type: 'king', color: 'white' },
      ],
      'black',
    );
    mustMove(engine, 'b1', 'a1');
    expect(engine.state.status).toBe('awaitingFusion');
    expect(engine.state.turn).toBe('black');
    expect(candidateSquares(engine)).toEqual(['h7']);
  });

  it('合成マス以外に着地したときは従来どおりターン交代する', () => {
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'h2', type: 'pawn', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'b4');
    expect(engine.state.status).toBe('playing');
    expect(engine.state.turn).toBe('black');
  });

  it('素材候補がゼロのときは awaitingFusion を経由せずターン交代する', () => {
    // 盤上の白駒はベース駒(ルーク)とキングのみ → 素材候補なし
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('playing');
    expect(engine.state.turn).toBe('black');
  });

  it('合成済みの駒が合成マスに着地しても再合成は発動しない', () => {
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white', fusedWith: 'knight' },
        { square: 'h2', type: 'pawn', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('playing');
    expect(engine.state.turn).toBe('black');
  });
});

describe('素材候補の選定', () => {
  it('キング・合成駒・ピン駒・ベース駒自身は素材候補から除外される', () => {
    const engine = engineWith(
      [
        { square: 'b6', type: 'knight', color: 'white' }, // a8 へ移動するベース駒
        { square: 'e1', type: 'king', color: 'white' }, // キング → 除外
        { square: 'e4', type: 'rook', color: 'white' }, // e8 の黒ルークにピン → 除外
        { square: 'c3', type: 'bishop', color: 'white', fusedWith: 'knight' }, // 合成駒 → 除外
        { square: 'h2', type: 'pawn', color: 'white' }, // 唯一の候補
        { square: 'e8', type: 'rook', color: 'black' },
        { square: 'g7', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b6', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');
    expect(candidateSquares(engine)).toEqual(['h2']);
  });

  it('awaitingFusion 以外の状態では素材候補は空配列', () => {
    const engine = new ChessEngine();
    expect(engine.getFusionCandidates()).toEqual([]);
    expect(engine.getFusionBaseSquare()).toBeNull();
  });
});

describe('tryFuse / skipFuse', () => {
  const fusionReady = (): ChessEngine => {
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'g1', type: 'knight', color: 'white' },
        { square: 'e3', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    return engine;
  };

  it('tryFuse で素材が消滅し fusedWith が設定されターン交代する', () => {
    const engine = fusionReady();
    expect(engine.state.status).toBe('awaitingFusion');
    expect(engine.getFusionBaseSquare()).toEqual(sq('a8'));

    const material = engine.tryFuse(sq('g1'));
    expect(material).toMatchObject({ type: 'knight', color: 'white' });
    expect(pieceAt(engine, 'g1')).toBeNull(); // 素材は盤から消える
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'rook', fusedWith: 'knight' });
    expect(engine.state.turn).toBe('black');
    expect(engine.state.status).toBe('playing');
    expect(engine.getFusionBaseSquare()).toBeNull();
  });

  it('skipFuse は合成せずターン交代だけを行う', () => {
    const engine = fusionReady();
    expect(engine.skipFuse()).toBe(true);
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'rook', fusedWith: null });
    expect(pieceAt(engine, 'g1')).toMatchObject({ type: 'knight' });
    expect(engine.state.turn).toBe('black');
    expect(engine.state.status).toBe('playing');
  });

  it('候補外のマス(キング・空マス・ベース自身)への tryFuse は失敗し状態が変わらない', () => {
    const engine = fusionReady();
    expect(engine.tryFuse(sq('e3'))).toBeNull(); // キング
    expect(engine.tryFuse(sq('d4'))).toBeNull(); // 空マス
    expect(engine.tryFuse(sq('a8'))).toBeNull(); // ベース駒自身
    expect(engine.tryFuse(sq('h5'))).toBeNull(); // 相手の駒
    expect(engine.state.status).toBe('awaitingFusion');
    expect(engine.state.turn).toBe('white');
  });

  it('awaitingFusion でないときの tryFuse / skipFuse は失敗する', () => {
    const engine = new ChessEngine();
    expect(engine.tryFuse(sq('b1'))).toBeNull();
    expect(engine.skipFuse()).toBe(false);
    expect(engine.state.turn).toBe('white');
  });

  it('awaitingFusion 中は移動操作を受け付けない', () => {
    const engine = fusionReady();
    expect(engine.getLegalMoves(sq('g1'))).toEqual([]);
    expect(engine.tryMove(sq('g1'), sq('f3'))).toBeNull();
    expect(engine.state.status).toBe('awaitingFusion');
  });
});

describe('合成駒の移動能力(和集合)', () => {
  it('ナイト+ルークはL字と縦横スライドの両方へ動ける', () => {
    const engine = engineWith(
      [
        { square: 'd4', type: 'knight', color: 'white', fusedWith: 'rook' },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    const knightDests = ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'];
    const rookDests = ['d1', 'd2', 'd3', 'd5', 'd6', 'd7', 'd8', 'a4', 'b4', 'c4', 'e4', 'f4', 'g4', 'h4'];
    expect(destinations(engine, 'd4')).toEqual([...knightDests, ...rookDests].sort());
  });

  it('能力が重複する組み合わせ(クイーン+ルーク)でも合法手が重複しない', () => {
    const fused = engineWith(
      [
        { square: 'd4', type: 'queen', color: 'white', fusedWith: 'rook' },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    const plain = engineWith(
      [
        { square: 'd4', type: 'queen', color: 'white' },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    // ルーク能力はクイーンの部分集合なので、合法手は素のクイーンと完全一致する
    expect(destinations(fused, 'd4')).toEqual(destinations(plain, 'd4'));
  });

  it('合成キング(キング+ルーク)はスライド移動もできる', () => {
    const engine = engineWith(
      [
        { square: 'a8', type: 'king', color: 'white', fusedWith: 'rook' },
        { square: 'h4', type: 'king', color: 'black' },
      ],
      'white',
    );
    const dests = destinations(engine, 'a8');
    expect(dests).toContain('a1'); // 縦の無制限スライド
    expect(dests).toContain('h8'); // 横の無制限スライド
    expect(dests).toContain('b7'); // 通常のキング移動
  });
});

describe('合成駒の利きと終局判定', () => {
  it('ポーン素材の斜め利きがチェック判定に反映される', () => {
    // c5 のナイト+ポーンは d6 を斜め前として攻撃する(ナイト能力では d6 を攻撃できない)
    const engine = engineWith(
      [
        { square: 'c5', type: 'knight', color: 'white', fusedWith: 'pawn' },
        { square: 'd6', type: 'king', color: 'black' },
        { square: 'a1', type: 'king', color: 'white' },
      ],
      'black',
    );
    expect(engine.state.status).toBe('check');
  });

  it('ナイト+ルークの合成駒でチェックメイトが成立する', () => {
    // h6 の合成駒: ルーク能力で h8 をチェック、ナイト能力で g8 を封鎖、白キングが g7 を封鎖
    const engine = engineWith(
      [
        { square: 'h8', type: 'king', color: 'black' },
        { square: 'h6', type: 'rook', color: 'white', fusedWith: 'knight' },
        { square: 'f6', type: 'king', color: 'white' },
      ],
      'black',
    );
    expect(engine.state.status).toBe('checkmate');
    expect(engine.state.winner).toBe('white');
  });

  it('同じ局面で素のルークならチェックメイトにならない(g8 へ逃げられる)', () => {
    const engine = engineWith(
      [
        { square: 'h8', type: 'king', color: 'black' },
        { square: 'h6', type: 'rook', color: 'white' },
        { square: 'f6', type: 'king', color: 'white' },
      ],
      'black',
    );
    expect(engine.state.status).toBe('check');
  });

  it('合成駒の利きでステールメイトが成立する', () => {
    // c7 のルーク+ビショップ: a7/b7 をルーク能力、b8 をビショップ能力で封鎖(a8 はチェックされない)
    const engine = engineWith(
      [
        { square: 'a8', type: 'king', color: 'black' },
        { square: 'c7', type: 'rook', color: 'white', fusedWith: 'bishop' },
        { square: 'e1', type: 'king', color: 'white' },
      ],
      'black',
    );
    expect(engine.state.status).toBe('stalemate');
    expect(engine.state.winner).toBeNull();
  });

  it('合成キングはチェック判定上キングとして扱われる', () => {
    // 合成キングが a1 の黒ルークにチェックされている → ルーク能力で取り返せる
    const engine = engineWith(
      [
        { square: 'a8', type: 'king', color: 'white', fusedWith: 'rook' },
        { square: 'a1', type: 'rook', color: 'black' },
        { square: 'h1', type: 'king', color: 'black' },
      ],
      'white',
    );
    expect(engine.state.status).toBe('check');
    expect(destinations(engine, 'a8')).toContain('a1'); // スライド能力でチェック元を捕獲できる
  });
});

describe('ポーン素材の付与能力', () => {
  it('前進1マスと斜め捕獲だけが追加される(2マス前進は不可)', () => {
    const engine = engineWith(
      [
        { square: 'd2', type: 'knight', color: 'white', fusedWith: 'pawn' },
        { square: 'e3', type: 'pawn', color: 'black' },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    const dests = destinations(engine, 'd2');
    expect(dests).toContain('d3'); // 前進1マス
    expect(dests).toContain('e3'); // 斜め捕獲
    expect(dests).not.toContain('d4'); // 初手2マスは付与されない
    expect(dests).not.toContain('c3'); // 空マスへ斜めには動けない
    expect(dests).toEqual(['b1', 'b3', 'c4', 'd3', 'e3', 'e4', 'f1', 'f3'].sort());
  });

  it('黒の合成駒は黒から見た前方(下方向)へ動く', () => {
    const engine = engineWith(
      [
        { square: 'd7', type: 'knight', color: 'black', fusedWith: 'pawn' },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'black',
    );
    const dests = destinations(engine, 'd7');
    expect(dests).toContain('d6'); // 黒の前方は rank 減少方向
    expect(dests).not.toContain('d8');
    expect(dests).not.toContain('d5'); // 2マスは不可
  });

  it('ポーン能力での最終段到達ではプロモーションしない', () => {
    const engine = engineWith(
      [
        { square: 'g7', type: 'knight', color: 'white', fusedWith: 'pawn' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'a5', type: 'king', color: 'black' },
      ],
      'white',
    );
    const move = engine.tryMove(sq('g7'), sq('g8'));
    expect(move).not.toBeNull();
    expect(move?.promotion).toBeNull();
    expect(pieceAt(engine, 'g8')).toMatchObject({ type: 'knight', fusedWith: 'pawn' });
  });

  it('ポーン能力ではアンパッサンできない', () => {
    const engine = engineWith(
      [
        { square: 'e5', type: 'knight', color: 'white', fusedWith: 'pawn' },
        { square: 'd7', type: 'pawn', color: 'black' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'black',
    );
    mustMove(engine, 'd7', 'd5'); // 黒ポーンが2マス前進して e5 の隣に

    const dests = destinations(engine, 'e5');
    expect(dests).toContain('e6'); // 前進1マスは可能
    expect(dests).not.toContain('d6'); // アンパッサンは付与されない
  });
});

describe('プロモーションと合成の競合', () => {
  it('合成マス到達ポーンは昇格が先に解決され、昇格後のクイーンがベース駒になる', () => {
    const engine = engineWith(
      [
        { square: 'b7', type: 'pawn', color: 'white', hasMoved: true },
        { square: 'a8', type: 'rook', color: 'black' },
        { square: 'b1', type: 'knight', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h6', type: 'king', color: 'black' },
      ],
      'white',
    );
    const move = engine.tryMove(sq('b7'), sq('a8'));
    expect(move).not.toBeNull();
    expect(move?.promotion).toBe('queen');

    // 昇格が解決済みで、クイーンをベース駒として素材選択待ちになる
    expect(engine.state.status).toBe('awaitingFusion');
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'queen', color: 'white' });
    expect(candidateSquares(engine)).toEqual(['b1']);

    // ナイトと合成してアマゾン(クイーン+ナイト)が成立する
    expect(engine.tryFuse(sq('b1'))).toMatchObject({ type: 'knight' });
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'queen', fusedWith: 'knight' });
    expect(engine.state.turn).toBe('black');

    // 黒が1手指した後、アマゾンはクイーンとナイト両方の手を持つ
    mustMove(engine, 'h6', 'h5');
    const dests = destinations(engine, 'a8');
    expect(dests).toContain('b6'); // ナイト能力
    expect(dests).toContain('c7'); // ナイト能力
    expect(dests).toContain('a1'); // クイーン能力(縦)
    expect(dests).toContain('h8'); // クイーン能力(横)
  });
});

describe('チェックとの関係', () => {
  it('素材消滅で相手キングへのディスカバードチェックが成立する(合法)', () => {
    const engine = engineWith(
      [
        { square: 'a5', type: 'rook', color: 'white' },
        { square: 'e4', type: 'knight', color: 'white' }, // 素材: 消えると e1-e8 が開く
        { square: 'e1', type: 'rook', color: 'white' },
        { square: 'g1', type: 'king', color: 'white' },
        { square: 'e8', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'a5', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');
    expect(candidateSquares(engine)).toContain('e4');

    expect(engine.tryFuse(sq('e4'))).toMatchObject({ type: 'knight' });
    // ナイトが消えて e1 のルークが黒キングをチェックする
    expect(engine.state.turn).toBe('black');
    expect(engine.state.status).toBe('check');
  });

  it('キングをベース駒として合成できる', () => {
    const engine = engineWith(
      [
        { square: 'b8', type: 'king', color: 'white' },
        { square: 'd5', type: 'rook', color: 'white' },
        { square: 'h4', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');
    expect(candidateSquares(engine)).toEqual(['d5']);

    expect(engine.tryFuse(sq('d5'))).toMatchObject({ type: 'rook' });
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'king', fusedWith: 'rook' });
  });
});
