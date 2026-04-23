// 逆向き解析の結果をReactアプリ用JSONにエクスポート
// 出力: src/gameData.ts (TypeScript module)

import { writeFileSync } from 'fs';

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const MAX_PIECES = 3;

function checkWin(b) {
  for (const line of LINES) {
    if (b[line[0]] !== 0 && line.every(i => b[i] === b[line[0]])) return b[line[0]];
  }
  return 0;
}

function stateKey(b, q0, q1, turn) {
  return b.join('') + '|' + q0.join(',') + '|' + q1.join(',') + '|' + turn;
}

// ============================================================
// Step 1: BFS全状態列挙
// ============================================================
console.log('Step 1: 全到達可能状態の列挙...');
console.time('Step 1');

const allStates = new Map();
const queue = [];

const initKey = stateKey(Array(9).fill(0), [], [], 1);
allStates.set(initKey, { b: Array(9).fill(0), q0: [], q1: [], turn: 1, successors: [], isTerminal: false, winner: 0 });
queue.push(initKey);

while (queue.length > 0) {
  const key = queue.shift();
  const state = allStates.get(key);
  const { b, q0, q1, turn } = state;
  const qi = turn - 1;
  const qs = [q0, q1];
  const empty = [];
  for (let i = 0; i < 9; i++) if (b[i] === 0) empty.push(i);
  if (empty.length === 0) { state.isTerminal = true; continue; }

  for (const cell of empty) {
    const newB = [...b];
    const newQ0 = [...q0], newQ1 = [...q1];
    const newQs = [newQ0, newQ1];
    if (newQs[qi].length >= MAX_PIECES) newB[newQs[qi].shift()] = 0;
    newB[cell] = turn;
    newQs[qi].push(cell);
    const winner = checkWin(newB);
    const nextTurn = 3 - turn;
    const childKey = stateKey(newB, newQ0, newQ1, nextTurn);
    state.successors.push({ key: childKey, cell });
    if (!allStates.has(childKey)) {
      allStates.set(childKey, { b: newB, q0: newQ0, q1: newQ1, turn: nextTurn, successors: [], isTerminal: winner !== 0, winner });
      if (winner === 0) queue.push(childKey);
    }
  }
}
console.timeEnd('Step 1');
console.log(`  状態数: ${allStates.size}`);

// ============================================================
// Step 2: 逆向き解析
// ============================================================
console.log('Step 2: 逆向き解析...');
console.time('Step 2');

const value = new Map();
const depth = new Map();
const bestMove = new Map();
const unresolved = new Map();
const parents = new Map();

for (const [key, state] of allStates) {
  for (const { key: childKey } of state.successors) {
    if (!parents.has(childKey)) parents.set(childKey, []);
    parents.get(childKey).push(key);
  }
}

const workQueue = [];
for (const [key, state] of allStates) {
  if (state.isTerminal && state.winner !== 0) {
    value.set(key, state.winner === 1 ? 1 : -1);
    depth.set(key, 0);
    workQueue.push(key);
  }
  unresolved.set(key, state.successors.length);
}

while (workQueue.length > 0) {
  const childKey = workQueue.shift();
  const childValue = value.get(childKey);
  const childDepth = depth.get(childKey);
  const parentKeys = parents.get(childKey) || [];

  for (const parentKey of parentKeys) {
    if (value.has(parentKey)) {
      const pVal = value.get(parentKey);
      const pDepth = depth.get(parentKey);
      const parentState = allStates.get(parentKey);
      const isMax = parentState.turn === 1;
      const myWin = isMax ? 1 : -1;
      if (childValue === myWin && pVal === myWin && childDepth + 1 < pDepth) {
        depth.set(parentKey, childDepth + 1);
        bestMove.set(parentKey, childKey);
        workQueue.push(parentKey);
      }
      continue;
    }

    const parentState = allStates.get(parentKey);
    const isMax = parentState.turn === 1;
    const myWin = isMax ? 1 : -1;
    const oppWin = isMax ? -1 : 1;

    if (childValue === myWin) {
      if (!value.has(parentKey) || depth.get(parentKey) > childDepth + 1) {
        value.set(parentKey, myWin);
        depth.set(parentKey, childDepth + 1);
        bestMove.set(parentKey, childKey);
        workQueue.push(parentKey);
      }
    } else if (childValue === oppWin) {
      unresolved.set(parentKey, unresolved.get(parentKey) - 1);
      if (unresolved.get(parentKey) === 0) {
        let maxD = 0, bestC = null;
        for (const { key: sKey } of parentState.successors) {
          if (value.has(sKey)) {
            const d = depth.get(sKey);
            if (d >= maxD) { maxD = d; bestC = sKey; }
          }
        }
        value.set(parentKey, oppWin);
        depth.set(parentKey, maxD + 1);
        bestMove.set(parentKey, bestC);
        workQueue.push(parentKey);
      }
    }
  }
}
console.timeEnd('Step 2');

// ============================================================
// Step 3: コンパクトなデータ形式でエクスポート
// ============================================================
console.log('Step 3: データエクスポート...');

// キーのエンコード: "board|q0|q1|turn" → コンパクトな文字列
// board: 9文字 (0/1/2)
// q0: カンマ区切りの数字
// q1: カンマ区切りの数字
// turn: 1 or 2
// → そのまま使う (十分コンパクト)

// 各状態に必要なデータ:
// - value: 1, -1, 0 (勝ち/負け/引分)
// - depth: 残り手数 (解決済みの場合)
// エンコード: value * 100 + depth → 1つの数値
// value=1, depth=13 → 113
// value=-1, depth=10 → -110
// value=0 → 0

const exportData = {};
let exportCount = 0;

for (const [key, state] of allStates) {
  const v = value.get(key);
  const d = depth.get(key);

  if (v === undefined) {
    // 引き分け（未解決）
    exportData[key] = 0;
  } else {
    exportData[key] = v * 1000 + (d ?? 0);
  }
  exportCount++;
}

console.log(`  エクスポート状態数: ${exportCount}`);

// JSON出力
const jsonStr = JSON.stringify(exportData);
console.log(`  JSON サイズ: ${(jsonStr.length / 1024 / 1024).toFixed(2)} MB`);

// TypeScriptモジュールとして出力
const tsContent = `// 自動生成: 3×3消滅三目並べ 完全解析データ
// 128,170状態の評価値 (逆向き解析による)
// キー: "board|q0|q1|turn"
// 値: value * 1000 + depth
//   正の値: 先手勝ち (例: 1013 = 先手勝ち、残り13手)
//   負の値: 後手勝ち (例: -1010 = 後手勝ち、残り10手)
//   0: 引き分け
//
// 統計:
//   先手必勝: ${[...value.values()].filter(v => v === 1).length}状態
//   後手必勝: ${[...value.values()].filter(v => v === -1).length}状態
//   引き分け: ${allStates.size - value.size}状態
//   合計: ${allStates.size}状態

export type GameValue = number;

const RAW_DATA: Record<string, GameValue> = ${jsonStr};

export function getStateKey(board: number[], q0: number[], q1: number[], turn: number): string {
  return board.join('') + '|' + q0.join(',') + '|' + q1.join(',') + '|' + turn;
}

export function lookupState(key: string): { value: number; depth: number } | null {
  const raw = RAW_DATA[key];
  if (raw === undefined) return null;
  if (raw === 0) return { value: 0, depth: 0 };
  const value = raw > 0 ? 1 : -1;
  const depth = Math.abs(raw) % 1000;
  return { value, depth };
}

export function getEvaluation(board: number[], q0: number[], q1: number[], turn: number): {
  value: number; // 1=先手勝ち, -1=後手勝ち, 0=引分
  depth: number; // 残り手数(解決済みの場合)
  moveEvals: { cell: number; value: number; depth: number }[]; // 各手の評価
} {
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const MAX_PIECES = 3;
  const key = getStateKey(board, q0, q1, turn);
  const state = lookupState(key);

  const currentValue = state?.value ?? 0;
  const currentDepth = state?.depth ?? 0;

  // 各合法手の評価
  const moveEvals: { cell: number; value: number; depth: number }[] = [];
  const empty: number[] = [];
  for (let i = 0; i < 9; i++) if (board[i] === 0) empty.push(i);

  const qi = turn - 1;
  for (const cell of empty) {
    const newB = [...board];
    const newQ0 = [...q0], newQ1 = [...q1];
    const newQs = [newQ0, newQ1];
    if (newQs[qi].length >= MAX_PIECES) newB[newQs[qi].shift()!] = 0;
    newB[cell] = turn;
    newQs[qi].push(cell);

    // 勝利チェック
    let win = 0;
    for (const line of LINES) {
      if (newB[line[0]] !== 0 && line.every(i => newB[i] === newB[line[0]])) {
        win = newB[line[0]];
        break;
      }
    }

    if (win !== 0) {
      moveEvals.push({ cell, value: win === 1 ? 1 : -1, depth: 0 });
    } else {
      const childKey = getStateKey(newB, newQ0, newQ1, 3 - turn);
      const childState = lookupState(childKey);
      moveEvals.push({
        cell,
        value: childState?.value ?? 0,
        depth: childState?.depth ?? 0,
      });
    }
  }

  return { value: currentValue, depth: currentDepth, moveEvals };
}

// ファントムリーチ検出
export function getPhantomReaches(board: number[], player: number, queues: number[][]): number[] {
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const qi = player - 1;
  const oldest = queues[qi].length >= 3 ? queues[qi][0] : -1;
  const phantoms: number[] = [];

  for (const line of LINES) {
    const mine = line.filter(x => board[x] === player).length;
    const empty = line.filter(x => board[x] === 0);
    if (mine === 2 && empty.length === 1) {
      if (oldest >= 0 && line.includes(oldest)) {
        phantoms.push(empty[0]); // このリーチはファントム
      }
    }
  }
  return [...new Set(phantoms)];
}

// 実リーチ検出
export function getRealReaches(board: number[], player: number, queues: number[][]): number[] {
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const qi = player - 1;
  const oldest = queues[qi].length >= 3 ? queues[qi][0] : -1;
  const reaches: number[] = [];

  for (const line of LINES) {
    const mine = line.filter(x => board[x] === player).length;
    const empty = line.filter(x => board[x] === 0);
    if (mine === 2 && empty.length === 1) {
      if (oldest >= 0 && line.includes(oldest)) continue; // ファントム
      reaches.push(empty[0]);
    }
  }
  return [...new Set(reaches)];
}

export default RAW_DATA;
`;

writeFileSync('src/gameData.ts', tsContent, 'utf-8');
console.log('  → src/gameData.ts に出力完了');

// サイズ確認
const rawSize = jsonStr.length;
console.log(`  Raw JSON: ${(rawSize / 1024).toFixed(0)} KB`);
