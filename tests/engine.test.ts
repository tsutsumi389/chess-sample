// ChessEngine のユニットテスト

import { describe, expect, it } from 'vitest';
import type {
  Board,
  GameState,
  Piece,
  PieceColor,
  PieceType,
} from '../src/types';
import { algebraicToSquare, squareEquals, squareToAlgebraic } from '../src/types';
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
      fusedWith: null,
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

/** 手番側の全合法手数を数える */
function countAllLegalMoves(engine: ChessEngine): number {
  let count = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      count += engine.getLegalMoves({ file, rank }).length;
    }
  }
  return count;
}

/** 代数表記で指す(失敗したらテストを落とす) */
function mustMove(engine: ChessEngine, from: string, to: string): void {
  const move = engine.tryMove(sq(from), sq(to));
  expect(move, `${from}-${to} は合法手のはず`).not.toBeNull();
}

describe('初期配置', () => {
  it('標準初期配置で白番・playing 状態になる', () => {
    const engine = new ChessEngine();
    const state = engine.state;

    expect(state.turn).toBe('white');
    expect(state.status).toBe('playing');
    expect(state.lastMove).toBeNull();
    expect(state.winner).toBeNull();

    const backRank: PieceType[] = [
      'rook',
      'knight',
      'bishop',
      'queen',
      'king',
      'bishop',
      'knight',
      'rook',
    ];
    for (let file = 0; file < 8; file++) {
      expect(state.board[0][file]).toMatchObject({ type: backRank[file], color: 'white' });
      expect(state.board[1][file]).toMatchObject({ type: 'pawn', color: 'white' });
      expect(state.board[6][file]).toMatchObject({ type: 'pawn', color: 'black' });
      expect(state.board[7][file]).toMatchObject({ type: backRank[file], color: 'black' });
    }

    // 中央4段は空
    for (let rank = 2; rank <= 5; rank++) {
      for (let file = 0; file < 8; file++) {
        expect(state.board[rank][file]).toBeNull();
      }
    }
  });

  it('state getter が返すオブジェクトを変更しても内部状態は壊れない', () => {
    const engine = new ChessEngine();
    const state = engine.state;
    state.board[0][4] = null;
    state.turn = 'black';
    expect(pieceAt(engine, 'e1')).toMatchObject({ type: 'king', color: 'white' });
    expect(engine.state.turn).toBe('white');
  });

  it('reset で初期状態に戻る', () => {
    const engine = new ChessEngine();
    mustMove(engine, 'e2', 'e4');
    engine.reset();
    expect(engine.state.turn).toBe('white');
    expect(pieceAt(engine, 'e2')).toMatchObject({ type: 'pawn', color: 'white' });
    expect(pieceAt(engine, 'e4')).toBeNull();
    expect(engine.state.lastMove).toBeNull();
  });
});

describe('各駒の基本移動', () => {
  it('ポーンは前1マス・初手のみ2マス進める', () => {
    const engine = new ChessEngine();
    expect(destinations(engine, 'e2')).toEqual(['e3', 'e4']);
  });

  it('ナイトは初期配置から2マスへ動ける(駒を飛び越せる)', () => {
    const engine = new ChessEngine();
    expect(destinations(engine, 'b1')).toEqual(['a3', 'c3']);
  });

  it('初期配置のビショップ・ルーク・クイーンは塞がれていて動けない', () => {
    const engine = new ChessEngine();
    expect(destinations(engine, 'c1')).toEqual([]);
    expect(destinations(engine, 'a1')).toEqual([]);
    expect(destinations(engine, 'd1')).toEqual([]);
  });

  it('ルークは上下左右に障害物まで動ける', () => {
    const engine = engineWith(
      [
        { square: 'd4', type: 'rook', color: 'white' },
        { square: 'd7', type: 'pawn', color: 'black' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    expect(destinations(engine, 'd4')).toEqual(
      ['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'd6', 'd7', 'e4', 'f4', 'g4', 'h4'].sort(),
    );
  });

  it('ビショップは斜めに動け、味方の駒は飛び越せない', () => {
    const engine = engineWith(
      [
        { square: 'c1', type: 'bishop', color: 'white' },
        { square: 'e3', type: 'pawn', color: 'white' },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    // e3 に味方ポーンがあるので d2 まで。反対側は b2, a3
    expect(destinations(engine, 'c1')).toEqual(['a3', 'b2', 'd2'].sort());
  });

  it('クイーンは8方向に動ける', () => {
    const engine = engineWith(
      [
        { square: 'd1', type: 'queen', color: 'white' },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    const dests = destinations(engine, 'd1');
    expect(dests).toContain('d8'); // 縦
    expect(dests).toContain('h1'); // 横
    expect(dests).toContain('h5'); // 斜め
    expect(dests).toContain('b1');
    expect(dests).toContain('a4');
  });

  it('キングは周囲1マスだけ動ける(敵の利きには入れない)', () => {
    const engine = engineWith(
      [
        { square: 'e4', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
        { square: 'a5', type: 'rook', color: 'black' },
      ],
      'white',
    );
    // 5段目はすべて黒ルークの利き
    expect(destinations(engine, 'e4')).toEqual(['d3', 'd4', 'e3', 'f3', 'f4'].sort());
  });

  it('違法手は tryMove が null を返し状態が変わらない', () => {
    const engine = new ChessEngine();
    const before = engine.state;

    expect(engine.tryMove(sq('e2'), sq('e5'))).toBeNull(); // ポーン3マス前進
    expect(engine.tryMove(sq('a1'), sq('a3'))).toBeNull(); // 塞がれたルーク
    expect(engine.tryMove(sq('e1'), sq('e2'))).toBeNull(); // 味方の駒があるマス
    expect(engine.tryMove(sq('e4'), sq('e5'))).toBeNull(); // 駒のないマスから

    expect(engine.state).toEqual(before);
  });

  it('駒がないマス・相手番の駒の合法手は空配列', () => {
    const engine = new ChessEngine();
    expect(engine.getLegalMoves(sq('e4'))).toEqual([]); // 駒なし
    expect(engine.getLegalMoves(sq('e7'))).toEqual([]); // 白番に黒の駒
  });
});

describe('合法手数', () => {
  it('初期局面の合法手数は20', () => {
    const engine = new ChessEngine();
    expect(countAllLegalMoves(engine)).toBe(20);
  });
});

describe('チェック・チェックメイト・ステールメイト', () => {
  it('チェックすると status が check になる', () => {
    const engine = new ChessEngine();
    mustMove(engine, 'e2', 'e4');
    mustMove(engine, 'f7', 'f6');
    const move = engine.tryMove(sq('d1'), sq('h5'));
    expect(move).not.toBeNull();
    expect(engine.state.status).toBe('check');
    expect(engine.state.turn).toBe('black');
  });

  it('チェック中はチェックを解消する手しか指せない', () => {
    const engine = new ChessEngine();
    mustMove(engine, 'e2', 'e4');
    mustMove(engine, 'f7', 'f6');
    mustMove(engine, 'd1', 'h5');
    // チェックを放置する手は違法
    expect(engine.tryMove(sq('a7'), sq('a6'))).toBeNull();
    // g6 でブロックするのは合法
    expect(engine.tryMove(sq('g7'), sq('g6'))).not.toBeNull();
  });

  it('フールズメイト(f3, e5, g4, Qh4#)でチェックメイトになる', () => {
    const engine = new ChessEngine();
    mustMove(engine, 'f2', 'f3');
    mustMove(engine, 'e7', 'e5');
    mustMove(engine, 'g2', 'g4');
    mustMove(engine, 'd8', 'h4');

    const state = engine.state;
    expect(state.status).toBe('checkmate');
    expect(state.winner).toBe('black');
    // ゲーム終了後は合法手なし・着手不可
    expect(countAllLegalMoves(engine)).toBe(0);
    expect(engine.tryMove(sq('a2'), sq('a3'))).toBeNull();
  });

  it('ステールメイト局面を判定できる', () => {
    // 黒キング h8。白クイーン g6 と白キング f7 により黒は動けないがチェックではない
    const engine = engineWith(
      [
        { square: 'h8', type: 'king', color: 'black' },
        { square: 'g6', type: 'queen', color: 'white' },
        { square: 'f7', type: 'king', color: 'white' },
      ],
      'black',
    );
    const state = engine.state;
    expect(state.status).toBe('stalemate');
    expect(state.winner).toBeNull();
    expect(countAllLegalMoves(engine)).toBe(0);
  });

  it('着手によってステールメイトに至る場合も判定できる', () => {
    // 白クイーンが g6 へ動くとステールメイト
    const engine = engineWith(
      [
        { square: 'h8', type: 'king', color: 'black' },
        { square: 'g1', type: 'queen', color: 'white' },
        { square: 'f7', type: 'king', color: 'white' },
      ],
      'white',
    );
    mustMove(engine, 'g1', 'g6');
    expect(engine.state.status).toBe('stalemate');
    expect(engine.state.winner).toBeNull();
  });
});

describe('キャスリング', () => {
  const castlingBase = (): PlacementSpec[] => [
    { square: 'e1', type: 'king', color: 'white' },
    { square: 'h1', type: 'rook', color: 'white' },
    { square: 'a1', type: 'rook', color: 'white' },
    { square: 'e8', type: 'king', color: 'black' },
  ];

  it('条件を満たせばキングサイドにキャスリングできる', () => {
    const engine = engineWith(castlingBase(), 'white');
    const moves = engine.getLegalMoves(sq('e1'));
    const castle = moves.find((m) => m.castling === 'kingside');
    expect(castle).toBeDefined();
    expect(castle && squareEquals(castle.to, sq('g1'))).toBe(true);

    const move = engine.tryMove(sq('e1'), sq('g1'));
    expect(move).not.toBeNull();
    expect(move?.castling).toBe('kingside');
    expect(pieceAt(engine, 'g1')).toMatchObject({ type: 'king', color: 'white' });
    expect(pieceAt(engine, 'f1')).toMatchObject({ type: 'rook', color: 'white' });
    expect(pieceAt(engine, 'e1')).toBeNull();
    expect(pieceAt(engine, 'h1')).toBeNull();
  });

  it('条件を満たせばクイーンサイドにキャスリングできる', () => {
    const engine = engineWith(castlingBase(), 'white');
    const move = engine.tryMove(sq('e1'), sq('c1'));
    expect(move).not.toBeNull();
    expect(move?.castling).toBe('queenside');
    expect(pieceAt(engine, 'c1')).toMatchObject({ type: 'king', color: 'white' });
    expect(pieceAt(engine, 'd1')).toMatchObject({ type: 'rook', color: 'white' });
    expect(pieceAt(engine, 'a1')).toBeNull();
  });

  it('キングが移動済みならキャスリングできない', () => {
    const placements = castlingBase();
    placements[0] = { ...placements[0], hasMoved: true };
    const engine = engineWith(placements, 'white');
    expect(engine.tryMove(sq('e1'), sq('g1'))).toBeNull();
    expect(engine.tryMove(sq('e1'), sq('c1'))).toBeNull();
  });

  it('ルークが移動済みならその側にキャスリングできない', () => {
    const placements = castlingBase();
    placements[1] = { ...placements[1], hasMoved: true }; // h1 ルーク
    const engine = engineWith(placements, 'white');
    expect(engine.tryMove(sq('e1'), sq('g1'))).toBeNull();
    // クイーンサイドは可能
    expect(engine.tryMove(sq('e1'), sq('c1'))).not.toBeNull();
  });

  it('間に駒があるとキャスリングできない', () => {
    const engine = engineWith(
      [...castlingBase(), { square: 'g1', type: 'knight', color: 'white' }],
      'white',
    );
    expect(engine.tryMove(sq('e1'), sq('g1'))).toBeNull();
  });

  it('クイーンサイドは b1 に駒があってもキャスリングできない', () => {
    const engine = engineWith(
      [...castlingBase(), { square: 'b1', type: 'knight', color: 'white' }],
      'white',
    );
    expect(engine.tryMove(sq('e1'), sq('c1'))).toBeNull();
  });

  it('キングがチェックされているとキャスリングできない', () => {
    const engine = engineWith(
      [...castlingBase(), { square: 'e5', type: 'rook', color: 'black' }],
      'white',
    );
    expect(engine.tryMove(sq('e1'), sq('g1'))).toBeNull();
    expect(engine.tryMove(sq('e1'), sq('c1'))).toBeNull();
  });

  it('キングの通過マスが攻撃されているとキャスリングできない', () => {
    const engine = engineWith(
      [...castlingBase(), { square: 'f5', type: 'rook', color: 'black' }],
      'white',
    );
    // f1 が攻撃されているのでキングサイド不可
    expect(engine.tryMove(sq('e1'), sq('g1'))).toBeNull();
    // クイーンサイドは影響なし
    expect(engine.tryMove(sq('e1'), sq('c1'))).not.toBeNull();
  });

  it('キングの到達マスが攻撃されているとキャスリングできない', () => {
    const engine = engineWith(
      [...castlingBase(), { square: 'g5', type: 'rook', color: 'black' }],
      'white',
    );
    expect(engine.tryMove(sq('e1'), sq('g1'))).toBeNull();
  });
});

describe('アンパッサン', () => {
  it('直前の2マス前進ポーンをアンパッサンで取れる', () => {
    const engine = new ChessEngine();
    mustMove(engine, 'e2', 'e4');
    mustMove(engine, 'a7', 'a6');
    mustMove(engine, 'e4', 'e5');
    mustMove(engine, 'd7', 'd5'); // 黒ポーンが2マス前進して e5 の隣に

    const moves = engine.getLegalMoves(sq('e5'));
    const ep = moves.find((m) => m.isEnPassant);
    expect(ep).toBeDefined();
    expect(ep && squareToAlgebraic(ep.to)).toBe('d6');

    const move = engine.tryMove(sq('e5'), sq('d6'));
    expect(move).not.toBeNull();
    expect(move?.isEnPassant).toBe(true);
    expect(move?.captured).toMatchObject({ type: 'pawn', color: 'black' });
    expect(pieceAt(engine, 'd6')).toMatchObject({ type: 'pawn', color: 'white' });
    expect(pieceAt(engine, 'd5')).toBeNull(); // 取られたポーンが消える
  });

  it('直前の手でなければアンパッサンできない', () => {
    const engine = new ChessEngine();
    mustMove(engine, 'e2', 'e4');
    mustMove(engine, 'a7', 'a6');
    mustMove(engine, 'e4', 'e5');
    mustMove(engine, 'd7', 'd5');
    mustMove(engine, 'a2', 'a3'); // 別の手を指す
    mustMove(engine, 'a6', 'a5');

    // 権利が消えている
    expect(engine.tryMove(sq('e5'), sq('d6'))).toBeNull();
  });

  it('1マス前進のポーンはアンパッサンで取れない', () => {
    const engine = new ChessEngine();
    mustMove(engine, 'e2', 'e4');
    mustMove(engine, 'd7', 'd6');
    mustMove(engine, 'e4', 'e5');
    mustMove(engine, 'd6', 'd5'); // 2マス前進ではない

    expect(engine.tryMove(sq('e5'), sq('d6'))).toBeNull();
  });
});

describe('プロモーション', () => {
  it('最終段到達で自動的にクイーンへ昇格する', () => {
    const engine = engineWith(
      [
        { square: 'a7', type: 'pawn', color: 'white', hasMoved: true },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    const move = engine.tryMove(sq('a7'), sq('a8'));
    expect(move).not.toBeNull();
    expect(move?.promotion).toBe('queen');
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'queen', color: 'white' });
  });

  it('駒を取りながらのプロモーションもクイーンへ昇格する', () => {
    const engine = engineWith(
      [
        { square: 'b7', type: 'pawn', color: 'white', hasMoved: true },
        { square: 'a8', type: 'rook', color: 'black' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    const move = engine.tryMove(sq('b7'), sq('a8'));
    expect(move).not.toBeNull();
    expect(move?.promotion).toBe('queen');
    expect(move?.captured).toMatchObject({ type: 'rook', color: 'black' });
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'queen', color: 'white' });
  });

  it('黒ポーンも1段目でクイーンへ昇格する', () => {
    const engine = engineWith(
      [
        { square: 'h2', type: 'pawn', color: 'black', hasMoved: true },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'e8', type: 'king', color: 'black' },
      ],
      'black',
    );
    const move = engine.tryMove(sq('h2'), sq('h1'));
    expect(move).not.toBeNull();
    expect(move?.promotion).toBe('queen');
    expect(pieceAt(engine, 'h1')).toMatchObject({ type: 'queen', color: 'black' });
  });
});

describe('ピン', () => {
  it('ピンされた駒は動けない', () => {
    // e2 のビショップは e8 の黒ルークにピンされている
    const engine = engineWith(
      [
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'e2', type: 'bishop', color: 'white' },
        { square: 'e8', type: 'rook', color: 'black' },
        { square: 'a8', type: 'king', color: 'black' },
      ],
      'white',
    );
    expect(engine.getLegalMoves(sq('e2'))).toEqual([]);
    expect(engine.tryMove(sq('e2'), sq('d3'))).toBeNull();
  });

  it('ピンされたルークはピンの方向(縦)には動ける', () => {
    const engine = engineWith(
      [
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'e4', type: 'rook', color: 'white' },
        { square: 'e8', type: 'rook', color: 'black' },
        { square: 'a8', type: 'king', color: 'black' },
      ],
      'white',
    );
    // 縦には動ける(e8 のルークを取る手も含む)が、横には動けない
    expect(destinations(engine, 'e4')).toEqual(['e2', 'e3', 'e5', 'e6', 'e7', 'e8'].sort());
  });
});
