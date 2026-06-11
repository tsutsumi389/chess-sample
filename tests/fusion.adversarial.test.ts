// 合成チェスの敵対的エッジケーステスト — docs/spec-fusion.md のルールの穴を突く局面を検証する
// (ピン素材の直接指定、ディスカバードチェックメイト、合成キングのメイト判定、
//  awaitingFusion 中の不正操作、素材候補ゼロ時の即ターン交代、仕様の境界条件)

import { describe, expect, it } from 'vitest';
import type {
  Board,
  GameState,
  Piece,
  PieceColor,
  PieceType,
} from '../src/types';
import { algebraicToSquare, squareToAlgebraic } from '../src/types';
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

describe('ピン駒と素材選択の敵対ケース', () => {
  it('候補リストを無視してピン駒を直接 tryFuse しても拒否され、盤面が変化しない', () => {
    // e4 のナイトは e8 の黒ルークにピンされている(消すと e1 の自玉がチェックされる)
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'e4', type: 'knight', color: 'white' }, // ピン駒
        { square: 'h2', type: 'pawn', color: 'white' }, // 唯一の正規候補
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'e8', type: 'rook', color: 'black' },
        { square: 'g8', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');
    expect(candidateSquares(engine)).toEqual(['h2']);

    // ピン駒を直接指定 → 失敗し、駒も状態もそのまま
    expect(engine.tryFuse(sq('e4'))).toBeNull();
    expect(pieceAt(engine, 'e4')).toMatchObject({ type: 'knight', color: 'white' });
    expect(engine.state.status).toBe('awaitingFusion');
    expect(engine.state.turn).toBe('white');

    // 正規候補は引き続き合成できる
    expect(engine.tryFuse(sq('h2'))).toMatchObject({ type: 'pawn' });
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'rook', fusedWith: 'pawn' });
  });

  it('ピン駒しか素材候補がない場合、awaitingFusion を経由せず即ターン交代する', () => {
    // 白のキング以外の駒は e4 のナイト(ピン)のみ → 候補ゼロ扱い
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'e4', type: 'knight', color: 'white' }, // e7 の黒ルークにピン
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'e7', type: 'rook', color: 'black' },
        { square: 'g6', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('playing');
    expect(engine.state.turn).toBe('black');
    expect(engine.getFusionCandidates()).toEqual([]);
    expect(pieceAt(engine, 'e4')).toMatchObject({ type: 'knight' }); // ピン駒は無傷
  });
});

describe('素材候補ゼロ時の即時終局判定', () => {
  it('候補ゼロの合成マス着地が同時にチェックメイトなら即座に checkmate になる', () => {
    // 白はキングとベース駒のみ。a8 着地でランク8をチェックし、g6 のキングが逃げ場を塞ぐ
    const engine = engineWith(
      [
        { square: 'a5', type: 'rook', color: 'white' },
        { square: 'g6', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'a5', 'a8');
    expect(engine.state.status).toBe('checkmate');
    expect(engine.state.winner).toBe('white');
    expect(engine.state.turn).toBe('black');
    // awaitingFusion を経由していないので合成操作はすべて失敗する
    expect(engine.tryFuse(sq('g6'))).toBeNull();
    expect(engine.skipFuse()).toBe(false);
  });
});

describe('素材消滅によるディスカバードチェックの敵対ケース', () => {
  it('素材消滅のディスカバードダブルチェックで即チェックメイトが成立する', () => {
    // h4 のナイト(素材)が消えると h1 のルークが h8 を直撃し、a8 のベース駒と合わせてダブルチェック
    const engine = engineWith(
      [
        { square: 'a5', type: 'rook', color: 'white' }, // ベース駒(a8 へ)
        { square: 'h4', type: 'knight', color: 'white' }, // 素材: 消えると h ファイルが開く
        { square: 'h1', type: 'rook', color: 'white' },
        { square: 'f6', type: 'king', color: 'white' }, // g7 を封鎖
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'a5', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');
    expect(candidateSquares(engine)).toContain('h4');

    expect(engine.tryFuse(sq('h4'))).toMatchObject({ type: 'knight' });
    // g8 は a8 ルーク、h7 は h1 ルーク、g7 は白キングが押さえ、逃げ場なし
    expect(engine.state.status).toBe('checkmate');
    expect(engine.state.winner).toBe('white');
  });

  it('合成で獲得した新能力そのものが即チェックを与える', () => {
    // a8 のルークがナイトを吸収すると、ナイト能力で c7 の黒キングをチェックする
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'g1', type: 'knight', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'c7', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');

    expect(engine.tryFuse(sq('g1'))).toMatchObject({ type: 'knight' });
    expect(engine.state.turn).toBe('black');
    expect(engine.state.status).toBe('check'); // a8 のナイト能力が c7 を攻撃
  });

  it('チェックを与えながらの合成マス着地は awaitingFusion が先行し、スキップ後に check が反映される', () => {
    const engine = engineWith(
      [
        { square: 'a5', type: 'rook', color: 'white' },
        { square: 'b2', type: 'pawn', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'a5', 'a8'); // ランク8経由で h8 をチェックしつつ合成マス着地
    expect(engine.state.status).toBe('awaitingFusion'); // check より素材選択が先
    expect(engine.state.turn).toBe('white');

    expect(engine.skipFuse()).toBe(true);
    expect(engine.state.status).toBe('check');
    expect(engine.state.turn).toBe('black');
  });
});

describe('合成キングのメイト判定', () => {
  it('素のキングならメイトだが、合成キング(+ナイト)はナイト能力で逃げられるため check 止まり', () => {
    // b8/b7 の白ルークでバックランクを完全封鎖。h8 からのナイト跳び g6 だけが空いている
    const engine = engineWith(
      [
        { square: 'h8', type: 'king', color: 'black', fusedWith: 'knight' },
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'b7', type: 'rook', color: 'white' },
        { square: 'a1', type: 'king', color: 'white' },
      ],
      'black',
    );
    expect(engine.state.status).toBe('check');
    expect(destinations(engine, 'h8')).toEqual(['g6']); // ナイト能力の逃げ道のみ
  });

  it('ナイト跳びの逃げ道まで塞ぐと合成キングもチェックメイトになる', () => {
    // 上記局面に h5 の白ポーンを足して g6 を封鎖 → 合成能力込みで逃げ場ゼロ
    const engine = engineWith(
      [
        { square: 'h8', type: 'king', color: 'black', fusedWith: 'knight' },
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'b7', type: 'rook', color: 'white' },
        { square: 'h5', type: 'pawn', color: 'white' }, // g6 を攻撃
        { square: 'a1', type: 'king', color: 'white' },
      ],
      'black',
    );
    expect(engine.state.status).toBe('checkmate');
    expect(engine.state.winner).toBe('white');
  });

  it('合成キング(hasMoved=true)にはキャスリング手が生成されない', () => {
    const engine = engineWith(
      [
        { square: 'e1', type: 'king', color: 'white', fusedWith: 'bishop', hasMoved: true },
        { square: 'h1', type: 'rook', color: 'white' },
        { square: 'e8', type: 'king', color: 'black' },
      ],
      'white',
    );
    expect(destinations(engine, 'e1')).not.toContain('g1');
  });

  it('hasMoved=false の合成キングでもキャスリングは不可(仕様6: 合成キングはキャスリング不可)', () => {
    // 通常プレイでは到達不能だが、仕様は「合成キングはキャスリング不可」と明記している
    const engine = engineWith(
      [
        { square: 'e1', type: 'king', color: 'white', fusedWith: 'bishop', hasMoved: false },
        { square: 'h1', type: 'rook', color: 'white' },
        { square: 'e8', type: 'king', color: 'black' },
      ],
      'white',
    );
    expect(destinations(engine, 'e1')).not.toContain('g1');
  });
});

describe('awaitingFusion 中の不正操作', () => {
  /** b8→a8 で素材選択待ちに入った局面を作る */
  const awaitingEngine = (): ChessEngine => {
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'g1', type: 'knight', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');
    return engine;
  };

  it('相手の駒も含め一切の移動操作を受け付けない', () => {
    const engine = awaitingEngine();
    expect(engine.getLegalMoves(sq('h5'))).toEqual([]); // 相手キング
    expect(engine.tryMove(sq('h5'), sq('h4'))).toBeNull();
    expect(engine.tryMove(sq('a8'), sq('a1'))).toBeNull(); // ベース駒自身の再移動
    expect(engine.state.status).toBe('awaitingFusion');
  });

  it('盤外座標の tryFuse は安全に失敗する', () => {
    const engine = awaitingEngine();
    expect(engine.tryFuse({ file: -1, rank: 9 })).toBeNull();
    expect(engine.tryFuse({ file: 8, rank: 0 })).toBeNull();
    expect(engine.state.status).toBe('awaitingFusion');
  });

  it('合成成立後に二重に tryFuse / skipFuse してもターンを盗めない', () => {
    const engine = awaitingEngine();
    expect(engine.tryFuse(sq('g1'))).toMatchObject({ type: 'knight' });
    expect(engine.state.turn).toBe('black');

    expect(engine.tryFuse(sq('g1'))).toBeNull(); // 二重合成
    expect(engine.skipFuse()).toBe(false); // 解決済みのスキップ
    expect(engine.state.turn).toBe('black'); // ターンは黒のまま
  });

  it('skipFuse 後の tryFuse も失敗する', () => {
    const engine = awaitingEngine();
    expect(engine.skipFuse()).toBe(true);
    expect(engine.tryFuse(sq('g1'))).toBeNull();
    expect(pieceAt(engine, 'g1')).toMatchObject({ type: 'knight' }); // 素材は無傷
    expect(engine.state.turn).toBe('black');
  });

  it('awaitingFusion 中に外部へ返した状態を書き換えても内部状態は壊れない', () => {
    const engine = awaitingEngine();

    // state はディープコピー: 返り値の盤面を破壊しても内部に影響しない
    const leaked = engine.state;
    leaked.board[7][0] = null; // a8 のベース駒を外部で消す
    leaked.turn = 'black';
    expect(pieceAt(engine, 'a8')).toMatchObject({ type: 'rook' });
    expect(engine.state.turn).toBe('white');

    // getFusionBaseSquare もコピー: 書き換えても合成先がずれない
    const base = engine.getFusionBaseSquare();
    expect(base).not.toBeNull();
    if (base) {
      base.file = 4;
      base.rank = 4;
    }
    expect(engine.getFusionBaseSquare()).toEqual(sq('a8'));
    expect(engine.tryFuse(sq('g1'))).toMatchObject({ type: 'knight' });
    expect(pieceAt(engine, 'a8')).toMatchObject({ fusedWith: 'knight' });
  });

  it('awaitingFusion 中の reset で合成待ち状態が完全に破棄される', () => {
    const engine = awaitingEngine();
    engine.reset();
    expect(engine.state.status).toBe('playing');
    expect(engine.state.turn).toBe('white');
    expect(engine.getFusionBaseSquare()).toBeNull();
    expect(engine.tryFuse(sq('g1'))).toBeNull();
    expect(engine.skipFuse()).toBe(false);
  });

  it('loadState は awaitingFusion を復元しない(文書化された制約)', () => {
    const state = buildState(
      [
        { square: 'a8', type: 'rook', color: 'white', hasMoved: true },
        { square: 'g1', type: 'knight', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );
    state.status = 'awaitingFusion'; // 偽装した素材選択待ちを読み込ませる
    const engine = new ChessEngine();
    engine.loadState(state);

    expect(engine.state.status).toBe('playing'); // 再計算される
    expect(engine.getFusionBaseSquare()).toBeNull();
    expect(engine.tryFuse(sq('g1'))).toBeNull();
    expect(engine.skipFuse()).toBe(false);
  });
});

describe('発動機会は着地の瞬間のみ', () => {
  it('スキップ後に合成マスへ留まり続けても再発動せず、出直して着地すれば再発動する', () => {
    const engine = engineWith(
      [
        { square: 'b8', type: 'rook', color: 'white' },
        { square: 'h2', type: 'pawn', color: 'white' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h5', type: 'king', color: 'black' },
      ],
      'white',
    );

    // 1回目の着地 → スキップ
    mustMove(engine, 'b8', 'a8');
    expect(engine.state.status).toBe('awaitingFusion');
    expect(engine.skipFuse()).toBe(true);

    // ルークが a8 に座ったまま別の駒を動かしても再発動しない
    mustMove(engine, 'h5', 'g5'); // 黒
    mustMove(engine, 'h2', 'h3'); // 白: ポーンを動かす(ルークは a8 のまま)
    expect(engine.state.status).toBe('playing');
    expect(engine.getFusionCandidates()).toEqual([]);

    // 一度離れてから着地し直すと再び発動機会を得る
    mustMove(engine, 'g5', 'h5'); // 黒
    mustMove(engine, 'a8', 'b8'); // 白: 合成マスを離れる
    mustMove(engine, 'h5', 'g5'); // 黒
    mustMove(engine, 'b8', 'a8'); // 白: 再着地
    expect(engine.state.status).toBe('awaitingFusion');
    expect(candidateSquares(engine)).toEqual(['h3']);
  });
});

describe('黒の昇格と合成の競合(白とのミラー)', () => {
  it('黒ポーンが a1 で捕獲昇格し、昇格後のクイーンをベースに合成できる', () => {
    const engine = engineWith(
      [
        { square: 'b2', type: 'pawn', color: 'black', hasMoved: true },
        { square: 'a1', type: 'rook', color: 'white' },
        { square: 'g8', type: 'knight', color: 'black' },
        { square: 'e8', type: 'king', color: 'black' },
        { square: 'h5', type: 'king', color: 'white' },
      ],
      'black',
    );
    const move = engine.tryMove(sq('b2'), sq('a1'));
    expect(move).not.toBeNull();
    expect(move?.promotion).toBe('queen');
    expect(move?.captured).toMatchObject({ type: 'rook', color: 'white' });

    expect(engine.state.status).toBe('awaitingFusion');
    expect(pieceAt(engine, 'a1')).toMatchObject({ type: 'queen', color: 'black' });
    expect(candidateSquares(engine)).toEqual(['g8']);

    expect(engine.tryFuse(sq('g8'))).toMatchObject({ type: 'knight' });
    expect(pieceAt(engine, 'a1')).toMatchObject({ type: 'queen', fusedWith: 'knight' });
    expect(engine.state.turn).toBe('white');
  });
});

describe('ベースポーンの能力境界', () => {
  it('ベース側のポーン能力は制限されない(初手2マス前進が残る)', () => {
    // 素材ポーンの制限(2マス・アンパッサン・昇格なし)はベース駒のポーン能力には適用されない
    const engine = engineWith(
      [
        { square: 'b2', type: 'pawn', color: 'white', fusedWith: 'knight' },
        { square: 'e1', type: 'king', color: 'white' },
        { square: 'h8', type: 'king', color: 'black' },
      ],
      'white',
    );
    const dests = destinations(engine, 'b2');
    expect(dests).toContain('b3'); // 前進1
    expect(dests).toContain('b4'); // 初手2マス(ベース能力なので可)
    expect(dests).toContain('a4'); // ナイト能力
    expect(dests).toContain('c4'); // ナイト能力
  });

  it('ポーン+ポーン合成駒の最終段への手は昇格手1つに正規化される', () => {
    // ベースのポーン能力(昇格あり)と素材のポーン能力(昇格なし)が同じマスへの
    // 手を二重生成しないこと。最終段への前進は自動クイーン昇格の1手のみであるべき
    const engine = engineWith(
      [
        { square: 'g7', type: 'pawn', color: 'white', fusedWith: 'pawn', hasMoved: true },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'a5', type: 'king', color: 'black' },
      ],
      'white',
    );
    const movesToG8 = engine
      .getLegalMoves(sq('g7'))
      .filter((m) => squareToAlgebraic(m.to) === 'g8');
    expect(movesToG8).toHaveLength(1);
    expect(movesToG8[0]?.promotion).toBe('queen');
  });

  it('ポーン+ポーン合成駒を tryMove で最終段へ進めると昇格が解決される', () => {
    const engine = engineWith(
      [
        { square: 'g7', type: 'pawn', color: 'white', fusedWith: 'pawn', hasMoved: true },
        { square: 'a1', type: 'king', color: 'white' },
        { square: 'a5', type: 'king', color: 'black' },
      ],
      'white',
    );
    const move = engine.tryMove(sq('g7'), sq('g8'));
    expect(move).not.toBeNull();
    expect(move?.promotion).toBe('queen');
    expect(pieceAt(engine, 'g8')).toMatchObject({ type: 'queen' });
  });
});
