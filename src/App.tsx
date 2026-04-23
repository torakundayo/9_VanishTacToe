import { useState, useMemo, useEffect, useCallback } from 'react'
import { getEvaluation } from './gameData'
import './index.css'

/* ===== Constants ===== */
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]
const MAX_PIECES = 3
const CELL_NAMES = ['左上', '上', '右上', '左', '中央', '右', '左下', '下', '右下']

/* ===== Types ===== */
type Page = 'play' | 'learn'
type GameMode = 'free' | 'challenge'
type Difficulty = 'easy' | 'medium' | 'hard'

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '初級',
  medium: '中級',
  hard: '上級',
}

interface MoveRecord {
  cell: number
  player: number
  wasOptimal: boolean
}

interface GameState {
  board: number[]
  q0: number[]
  q1: number[]
  turn: number
  winner: number
  winLine: number[] | null
  moveCount: number
  lastMoveCell: number | null
  pieceIds: number[]
  nextPieceId: number
  moveHistory: MoveRecord[]
}

const INITIAL_STATE: GameState = {
  board: Array(9).fill(0),
  q0: [],
  q1: [],
  turn: 1,
  winner: 0,
  winLine: null,
  moveCount: 0,
  lastMoveCell: null,
  pieceIds: Array(9).fill(0),
  nextPieceId: 1,
  moveHistory: [],
}

/* ===== Pure helpers ===== */

function checkWin(b: number[]): { winner: number; line: number[] } | null {
  for (const line of LINES) {
    if (b[line[0]] !== 0 && line.every(i => b[i] === b[line[0]])) {
      return { winner: b[line[0]], line }
    }
  }
  return null
}

function applyMoveToState(state: GameState, cell: number): GameState {
  const board = [...state.board]
  const q0 = [...state.q0]
  const q1 = [...state.q1]
  const qs = [q0, q1]
  const qi = state.turn - 1
  const pieceIds = [...state.pieceIds]

  if (qs[qi].length >= MAX_PIECES) {
    const removed = qs[qi].shift()!
    board[removed] = 0
    pieceIds[removed] = 0
  }

  board[cell] = state.turn
  qs[qi].push(cell)
  pieceIds[cell] = state.nextPieceId

  const result = checkWin(board)

  return {
    board,
    q0,
    q1,
    turn: result ? state.turn : 3 - state.turn,
    winner: result?.winner ?? 0,
    winLine: result?.line ?? null,
    moveCount: state.moveCount + 1,
    lastMoveCell: cell,
    pieceIds,
    nextPieceId: state.nextPieceId + 1,
    moveHistory: state.moveHistory,
  }
}

function getMoveClass(value: number, turn: number): 'win' | 'draw' | 'lose' {
  if (value === 0) return 'draw'
  const isMyWin = (turn === 1 && value === 1) || (turn === 2 && value === -1)
  return isMyWin ? 'win' : 'lose'
}

function checkOptimality(
  evaluation: ReturnType<typeof getEvaluation>,
  cell: number,
  turn: number,
): boolean {
  const me = evaluation.moveEvals.find(m => m.cell === cell)
  if (!me) return false
  const isMax = turn === 1
  const bestValue = isMax
    ? Math.max(...evaluation.moveEvals.map(m => m.value))
    : Math.min(...evaluation.moveEvals.map(m => m.value))
  return me.value === bestValue
}

function pickBestCell(
  evaluation: ReturnType<typeof getEvaluation>,
  turn: number,
): number {
  const myWinValue = turn === 1 ? 1 : -1
  let bestScore = -Infinity
  let best = evaluation.moveEvals[0]?.cell ?? 0
  for (const me of evaluation.moveEvals) {
    let score: number
    if (me.value === myWinValue) score = 20000 + me.depth
    else if (me.value === 0) score = 10000
    else score = me.depth
    if (score > bestScore) {
      bestScore = score
      best = me.cell
    }
  }
  return best
}

function pickAiMove(
  evaluation: ReturnType<typeof getEvaluation>,
  turn: number,
  difficulty: Difficulty,
): number {
  const cells = evaluation.moveEvals.map(m => m.cell)
  if (cells.length === 0) return 0
  if (difficulty === 'hard') return pickBestCell(evaluation, turn)
  const optimalProb = difficulty === 'easy' ? 0.25 : 0.65
  if (Math.random() < optimalProb) return pickBestCell(evaluation, turn)
  return cells[Math.floor(Math.random() * cells.length)]
}

/* ================================================================
   MiniBoard — 棋譜用の小型盤面アイコン
   ================================================================ */

function MiniBoard({ cell, player }: { cell: number; player: number }) {
  return (
    <span className="mini-board" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={`mini-cell ${i === cell ? `filled p${player}` : ''}`}
        />
      ))}
    </span>
  )
}

/* ================================================================
   Learn Page — 教育コンテンツ
   ================================================================ */

function LearnPage() {
  return (
    <div className="learn-page">

      <section className="article" id="sec-complete">
        <h2>1. 完全解析 — このゲームの「答え」</h2>

        <p>
          消滅三目並べは、<strong>先手が必ず勝てるゲーム</strong>です。
        </p>
        <p>
          これは推測でも経験則でもありません。コンピュータが
          <strong>128,170通り</strong>のすべての到達可能な局面を調べ上げた結果、
          数学的に証明された事実です。
        </p>

        <h3>逆向き解析（レトログレード解析）</h3>
        <p>
          通常のゲームAIは、現在の局面から先の手を「読む」ことで最善手を探します。
          しかし消滅ルールがあるこのゲームでは、駒が消えることで同じ局面が
          繰り返し現れる可能性があり、通常の再帰的な探索では無限ループに
          陥ってしまいます。
        </p>
        <p>
          そこで使用したのが<strong>逆向き解析</strong>（レトログレード解析）です。
          これはチェスのエンドゲームテーブルベースでも使われる手法で、
          以下の2段階で行われます。
        </p>
        <ol>
          <li>
            <strong>全状態の列挙</strong> —
            空の盤面から始めて、すべての合法手を辿り、到達可能なすべての局面を
            幅優先探索（BFS）で列挙する。結果：128,170状態。
          </li>
          <li>
            <strong>逆方向の評価伝播</strong> —
            ゲームが終了している局面（3つ揃った状態）から逆方向に辿り、
            各局面の勝敗を確定させる。
            「自分が勝てる子局面が1つでもあれば勝ち」
            「すべての子局面で負けるなら負け」
            というルールで伝播させる。
          </li>
        </ol>
        <p>
          この手法なら、循環する局面があっても正確に解析できます。
        </p>

        <h3>解析結果</h3>
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-num">128,170</span>
            <span className="stat-label">全状態数</span>
          </div>
          <div className="stat-card">
            <span className="stat-num s-win">54,853</span>
            <span className="stat-label">先手必勝</span>
          </div>
          <div className="stat-card">
            <span className="stat-num s-lose">60,124</span>
            <span className="stat-label">後手必勝</span>
          </div>
          <div className="stat-card">
            <span className="stat-num s-draw">13,193</span>
            <span className="stat-label">引き分け</span>
          </div>
        </div>

        <h3>初手の評価</h3>
        <p>
          先手の勝ち手は<strong>辺の中央</strong>（上・下・左・右）の4箇所のみです。
          角や中央から始めると、後手が正しく対応すれば引き分けに持ち込まれます。
        </p>
        <table className="eval-table">
          <thead>
            <tr><th>初手</th><th>結果</th><th>最短決着</th></tr>
          </thead>
          <tbody>
            <tr className="row-win"><td>上（セル1）</td><td>先手勝ち</td><td>13手</td></tr>
            <tr className="row-win"><td>左（セル3）</td><td>先手勝ち</td><td>13手</td></tr>
            <tr className="row-win"><td>右（セル5）</td><td>先手勝ち</td><td>13手</td></tr>
            <tr className="row-win"><td>下（セル7）</td><td>先手勝ち</td><td>13手</td></tr>
            <tr className="row-draw"><td>左上（セル0）</td><td>引き分け</td><td>—</td></tr>
            <tr className="row-draw"><td>右上（セル2）</td><td>引き分け</td><td>—</td></tr>
            <tr className="row-draw"><td>中央（セル4）</td><td>引き分け</td><td>—</td></tr>
            <tr className="row-draw"><td>左下（セル6）</td><td>引き分け</td><td>—</td></tr>
            <tr className="row-draw"><td>右下（セル8）</td><td>引き分け</td><td>—</td></tr>
          </tbody>
        </table>
        <p>
          どの勝ち手から始めても、最短必勝手数は等しく13手です。
          「13手チャレンジ」モードでこの手順の実行に挑戦できます。
        </p>
      </section>

      <section className="article" id="sec-gap">
        <h2>2. 理論と実践の乖離 — 必勝なのに勝てない</h2>

        <p>
          先手必勝——数学的に先手は必ず勝てる。にもかかわらず、
          実際にこのゲームをプレイする人間が先手で勝てることは<strong>ほとんどありません</strong>。
        </p>

        <h3>勝ち手は毎回たった1つ</h3>
        <p>
          完全解析の結果、驚くべき事実が判明しました。
          辺の中央に初手を打った後、<strong>3手目以降は毎回勝ち手がたった1つしかありません</strong>。
        </p>
        <p>
          先手は13手の間に7回の選択を行います（1, 3, 5, 7, 9, 11, 13手目）。
          このうち3手目以降の6回すべてで、唯一の正解を選び続けなければなりません。
          1つでも間違えれば、局面は引き分けに転落します。
        </p>
        <p>
          9マスのシンプルなゲームとしては異常なほど「狭い」勝ち筋です。
          通常の三目並べでは複数の勝ち手が存在する局面が多いのに対し、
          消滅ルールが選択肢を極端に制限しています。
        </p>

        <h3>確率で見る不可能性</h3>
        <p>
          3つの空きマスから1つの正解を選ぶ——確率にすれば33%です。
          これを6回連続で正解し続ける確率は：
        </p>
        <div className="formula">
          (1/3)<sup>6</sup> ≈ 0.14%
        </div>
        <p>
          <strong>約700回に1回</strong>しか成功しない計算です。
          しかも実際のゲームでは相手のリーチを防ぐ義務もあり、
          「3つの中から自由に選ぶ」という前提自体が楽観的です。
        </p>
        <p>
          数学的に「必ず勝てる」のに、人間が実際に勝てるのは700回に1回以下。
          これが理論と実践の乖離——<strong>証明された必勝法が、実行不可能である</strong>
          という矛盾です。
        </p>
      </section>

      <section className="article" id="sec-chicken">
        <h2>3. チキンゲームのジレンマ</h2>

        <p>
          このゲームにはもう一つ、ゲーム理論の教科書に載るような
          興味深い現象が潜んでいます。<strong>チキンゲーム</strong>です。
        </p>

        <h3>膠着状態の発生</h3>
        <p>
          両プレイヤーがお互いのリーチを防ぎ合いながら中央や角を
          優先的に打つと、同じ局面パターンが繰り返される膠着状態に陥ります。
          50,000局のシミュレーション結果は以下の通りです。
        </p>
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-label">リーチ防御 + 中央角優先</span>
            <span className="stat-num s-lose">100%千日手</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">リーチ防御 + ランダム</span>
            <span className="stat-num s-win">88.8%決着</span>
          </div>
        </div>
        <p>
          つまり、少しでも戦略的な打ち方をすると、
          ゲームは<strong>永遠に終わらなくなります</strong>。
          決着するためには、どちらかが「いつもと違う手」を打つ必要があります。
        </p>

        <h3>崩した方が負ける</h3>
        <p>
          膠着を破るために「いつもと違う手」を打ったプレイヤーは
          どうなるでしょうか。シミュレーションの結果：
        </p>
        <ul>
          <li>膠着を崩したプレイヤーは<strong>約80%の確率で負ける</strong></li>
          <li>崩してから決着までの中央値はわずか<strong>2手</strong></li>
        </ul>
        <p>
          これはまさに「チキンゲーム」です。
          2台の車が正面衝突コースで走り、先にハンドルを切った方が
          「チキン（臆病者）」と呼ばれるあの有名なゲーム理論のモデル——
          それと同じ構造がこの小さな3×3のゲームに内在しています。
        </p>
        <p>
          <strong>先に動いた方が負ける。しかし誰も動かなければ永遠に決着しない。</strong>
        </p>

        <h3>ゲーム理論における意義</h3>
        <p>
          チキンゲームは冷戦期の核抑止論から国際関係の分析まで、
          幅広い場面で使われる重要なモデルです。
          「互いに譲らなければ最悪の結果になるが、先に譲った方が不利になる」
          というジレンマは、ビジネスの価格競争や日常の交渉にも
          形を変えて現れます。
        </p>
        <p>
          消滅三目並べという単純なゲームが、このような深い構造を
          内包していることは、ゲーム理論が日常に潜む場所の多さを
          示唆しています。
        </p>
      </section>

      <section className="article" id="sec-tree">
        <h2>4. ゲーム木 — 選択と結果の因果関係</h2>

        <p>
          「フリープレイ」モードで評価をONにすると、
          各マスに色付きの評価が表示されます。
          これは<strong>ゲーム木（ゲームツリー）</strong>の断面を
          可視化したものです。
        </p>

        <h3>ゲーム木とは</h3>
        <p>
          ゲーム木は、ある局面から可能なすべての選択肢と
          その結果を樹形図で表現したものです。
          根が現在の局面、枝が各選択肢、葉が最終結果です。
        </p>
        <p>
          消滅三目並べの場合：
        </p>
        <ul>
          <li>根 — 空の盤面（ゲーム開始時）</li>
          <li>各ノード — ある時点での局面（128,170通り）</li>
          <li>枝 — 空きマスへの着手</li>
          <li>葉 — 誰かが3つ揃えた終了局面</li>
        </ul>

        <h3>評価の色の意味</h3>
        <div className="color-legend">
          <div className="legend-item">
            <span className="legend-dot lg-win" />
            <div>
              <strong>緑 — 勝ち</strong>
              <p>この手を打てば、相手が最善を尽くしてもあなたが勝てます。</p>
            </div>
          </div>
          <div className="legend-item">
            <span className="legend-dot lg-draw" />
            <div>
              <strong>灰 — 引き分け</strong>
              <p>この手を打つと、双方が最善を尽くせば引き分けになります。</p>
            </div>
          </div>
          <div className="legend-item">
            <span className="legend-dot lg-lose" />
            <div>
              <strong>赤 — 負け</strong>
              <p>この手を打つと、相手が正しく対応すればあなたが負けます。</p>
            </div>
          </div>
        </div>
        <p>
          通常のゲームでは、未来は不確実です。
          しかしこのサイトでは128,170すべての局面を解析済みであるため、
          あなたの各選択が<strong>どの結末に導くかを正確に</strong>
          表示できます。
          これは「完全情報の可視化」——あらゆる選択の因果関係を
          一目で見渡せるという、通常のゲーム体験では得られない視点です。
        </p>
      </section>

      <section className="article" id="sec-heuristic">
        <h2>5. ヒューリスティックの限界</h2>

        <p>
          通常の三目並べでは、
          「<strong>中央を取れ</strong>」「<strong>角を取れ</strong>」
          という経験則（ヒューリスティック）が有効です。
          しかし消滅ルールが加わると、この直感は完全に裏切られます。
        </p>

        <h3>なぜ中央が最善ではないのか</h3>
        <p>
          通常の三目並べでは中央は4本のライン（横・縦・斜め2本）に
          関与するため、最も価値の高い位置です。
          しかし消滅ルール下では状況が一変します。
        </p>
        <ol>
          <li>中央に置いても、3手後にはその駒が消える</li>
          <li>中央を維持するには毎回中央に置き直す必要がある</li>
          <li>その間、他の位置で布石を打つ余裕がなくなる</li>
        </ol>
        <p>
          一方、辺の中央（セル1, 3, 5, 7）は2本のラインに関与しつつ、
          消滅の影響を受けにくい位置関係を構築できます。
          「最も多くのラインに関与する位置が最善」という
          従来のヒューリスティックは、消滅ルールの前では通用しません。
        </p>

        <h3>ヒューリスティック同士の対戦結果</h3>
        <p>
          「中央や角を優先する」「リーチは必ず防ぐ」というルールに
          従うAI同士を50,000局対戦させた結果：
        </p>
        <div className="formula">
          100%千日手——1局も決着しない
        </div>
        <p>
          ヒューリスティックは「だいたい正しい」判断を素早く下すための
          道具です。人間の直感もAIの評価関数も、その多くは
          ヒューリスティックに基づいています。
          しかしこのゲームのように微妙な構造を持つ問題では、
          「だいたい正しい」では不十分です。
        </p>
        <p>
          完全解析が可能なほど小さな問題でさえヒューリスティックが
          失敗するという事実は、より大きな問題——将棋やチェス、
          あるいは現実世界の意思決定——において、
          直感や経験則にどこまで頼れるかを考えさせます。
        </p>
      </section>

    </div>
  )
}

/* ================================================================
   Game Page — ゲーム部分
   ================================================================ */

function GamePage() {
  const [gameMode, setGameMode] = useState<GameMode>('free')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [game, setGame] = useState<GameState>({ ...INITIAL_STATE, moveHistory: [] })
  const [showEval, setShowEval] = useState(false)
  const [isOThinking, setIsOThinking] = useState(false)
  const [challengeStatus, setChallengeStatus] = useState<'playing' | 'success' | 'failed'>('playing')
  const [showHint, setShowHint] = useState(false)

  const evaluation = useMemo(() => {
    if (game.winner) return null
    return getEvaluation(game.board, game.q0, game.q1, game.turn)
  }, [game.board, game.q0, game.q1, game.turn, game.winner])

  const oldest = [
    game.q0.length >= 3 ? game.q0[0] : -1,
    game.q1.length >= 3 ? game.q1[0] : -1,
  ]

  /* O auto-play (challenge=常に最適、free=難易度適用) */
  useEffect(() => {
    if (game.turn !== 2 || game.winner !== 0) return

    setIsOThinking(true)
    const eval_ = getEvaluation(game.board, game.q0, game.q1, 2)
    const aiDifficulty: Difficulty = gameMode === 'challenge' ? 'hard' : difficulty
    const aiCell = pickAiMove(eval_, 2, aiDifficulty)
    const wasOptimal = checkOptimality(eval_, aiCell, 2)

    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      setGame(prev => {
        if (prev.winner !== 0 || prev.turn !== 2) return prev
        const newState = applyMoveToState(prev, aiCell)
        return {
          ...newState,
          moveHistory: [...prev.moveHistory, { cell: aiCell, player: 2, wasOptimal }],
        }
      })
      setIsOThinking(false)
    }, 600)

    return () => { cancelled = true; clearTimeout(timer); setIsOThinking(false) }
  }, [gameMode, difficulty, game.turn, game.winner, game.moveCount])

  useEffect(() => {
    if (gameMode !== 'challenge') return
    if (game.winner === 1) setChallengeStatus('success')
    else if (game.winner === 2) setChallengeStatus('failed')
  }, [game.winner, gameMode])

  const handleCellClick = useCallback((cell: number) => {
    if (game.winner || game.board[cell] !== 0) return
    if (game.turn === 2) return
    if (isOThinking) return
    if (gameMode === 'challenge' && challengeStatus === 'failed') return

    const wasOptimal = evaluation ? checkOptimality(evaluation, cell, game.turn) : true

    setGame(prev => {
      const newState = applyMoveToState(prev, cell)
      return {
        ...newState,
        moveHistory: [...prev.moveHistory, { cell, player: prev.turn, wasOptimal }],
      }
    })
    setShowHint(false)

    if (gameMode === 'challenge' && !wasOptimal) {
      setChallengeStatus('failed')
    }
  }, [game.winner, game.board, game.turn, gameMode, isOThinking, challengeStatus, evaluation])

  const reset = useCallback(() => {
    setGame({ ...INITIAL_STATE, pieceIds: Array(9).fill(0), moveHistory: [] })
    setChallengeStatus('playing')
    setShowHint(false)
    setIsOThinking(false)
  }, [])

  const switchGameMode = useCallback((m: GameMode) => {
    setGameMode(m)
    setGame({ ...INITIAL_STATE, pieceIds: Array(9).fill(0), moveHistory: [] })
    setChallengeStatus('playing')
    setShowHint(false)
    setIsOThinking(false)
    setShowEval(false)
  }, [])

  const switchDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d)
    setGame({ ...INITIAL_STATE, pieceIds: Array(9).fill(0), moveHistory: [] })
    setChallengeStatus('playing')
    setShowHint(false)
    setIsOThinking(false)
  }, [])

  const evalValue = evaluation
    ? evaluation.value
    : (game.winner === 1 ? 1 : game.winner === 2 ? -1 : 0)
  const evalDepth = evaluation?.depth ?? 0

  const hintCell = useMemo(() => {
    if (!evaluation || gameMode !== 'challenge' || game.turn !== 1) return -1
    const winningMoves = evaluation.moveEvals.filter(m => m.value === 1)
    if (winningMoves.length === 0) return evaluation.moveEvals[0]?.cell ?? -1
    const minDepth = Math.min(...winningMoves.map(m => m.depth))
    return winningMoves.find(m => m.depth === minDepth)?.cell ?? -1
  }, [evaluation, gameMode, game.turn])

  const showEvalOverlay = showEval && gameMode === 'free' && !game.winner
  const showMoveTree = showEval && gameMode === 'free' && !game.winner && evaluation

  return (
    <div className="game-page">
      {/* Game mode toggle */}
      <div className="mode-tabs">
        <button
          className={`mode-tab ${gameMode === 'free' ? 'active' : ''}`}
          onClick={() => switchGameMode('free')}
        >
          フリープレイ
        </button>
        <button
          className={`mode-tab ${gameMode === 'challenge' ? 'active' : ''}`}
          onClick={() => switchGameMode('challenge')}
        >
          13手チャレンジ
        </button>
      </div>

      {/* Difficulty selector (free mode only) */}
      {gameMode === 'free' && (
        <div className="difficulty-select" role="radiogroup" aria-label="難易度">
          <span className="diff-label">難易度</span>
          {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
            <button
              key={d}
              className={`diff-btn ${difficulty === d ? 'active' : ''}`}
              onClick={() => switchDifficulty(d)}
              aria-checked={difficulty === d}
              role="radio"
            >
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>
      )}

      {/* Challenge progress */}
      {gameMode === 'challenge' && (
        <div className="challenge-bar">
          <div className="challenge-progress">
            <div
              className="challenge-fill"
              style={{ width: `${Math.min((game.moveCount / 13) * 100, 100)}%` }}
            />
          </div>
          <div className="challenge-label">
            <span>{game.moveCount} / 13手</span>
            {challengeStatus === 'success' && <span className="challenge-ok">完全勝利！</span>}
            {challengeStatus === 'failed' && <span className="challenge-ng">失敗</span>}
          </div>
        </div>
      )}

      {/* Status */}
      <div className={`status p${game.winner || game.turn}`} role="status" aria-live="polite">
        {game.winner ? (
          <span className="winner-text">
            <span className={`player-marker p${game.winner}`} aria-hidden="true" />
            {game.winner === 1 ? 'ほのお' : 'クリスタル'} の勝ち！
          </span>
        ) : isOThinking ? (
          <span className="thinking">
            <span className="player-marker p2" aria-hidden="true" />
            クリスタル 思考中…
          </span>
        ) : (
          <>
            <span className={`player-marker p${game.turn}`} aria-hidden="true" />
            {game.turn === 1 ? 'ほのお' : 'クリスタル'} のターン
          </>
        )}
      </div>

      {/* Evaluation bar */}
      {(showEval || gameMode === 'challenge') && (
        <div className="eval-section">
          <div className="eval-bar">
            <div className="eval-track">
              <div
                className={`eval-fill ${evalValue === 1 ? 'p1' : evalValue === -1 ? 'p2' : 'neutral'}`}
                style={{ width: `${50 + evalValue * 45}%` }}
              />
              <div className="eval-center-line" />
            </div>
          </div>
          <div className="eval-label">
            {game.winner
              ? (game.winner === 1 ? '先手の勝利' : '後手の勝利')
              : evalValue === 1
                ? `先手勝ち 残り${evalDepth}手`
                : evalValue === -1
                  ? `後手勝ち 残り${evalDepth}手`
                  : '引き分け'
            }
          </div>
        </div>
      )}

      {/* Board */}
      <div className="board" role="grid" aria-label="ゲームボード">
        {game.board.map((cell, i) => {
          const moveEval = evaluation?.moveEvals.find(m => m.cell === i)
          const isEmpty = cell === 0 && !game.winner
          const isHinted = showHint && gameMode === 'challenge' && hintCell === i
          const evalClass = showEvalOverlay && isEmpty && moveEval
            ? getMoveClass(moveEval.value, game.turn)
            : null
          const isOldest = cell !== 0 && oldest[cell - 1] === i && !game.winner
          const isNextToVanish = isOldest && cell === game.turn

          return (
            <button
              key={i}
              className={[
                'cell',
                isEmpty && 'empty',
                game.winLine?.includes(i) && 'win',
                game.lastMoveCell === i && 'last-move',
                isHinted && 'hint-cell',
                evalClass && `eval-${evalClass}`,
              ].filter(Boolean).join(' ')}
              onClick={() => handleCellClick(i)}
              disabled={!isEmpty || isOThinking}
              aria-label={`${CELL_NAMES[i]}${cell === 1 ? ' ほのお' : cell === 2 ? ' クリスタル' : ' 空き'}${isNextToVanish ? ' 次に消える駒' : ''}`}
            >
              {cell !== 0 && (
                <div key={game.pieceIds[i]} className="pop-wrapper">
                  <div
                    className={[
                      'piece',
                      `p${cell}`,
                      isOldest && 'oldest',
                      isNextToVanish && 'will-vanish',
                    ].filter(Boolean).join(' ')}
                  >
                    <div className="shape" />
                  </div>
                  {isOldest && (
                    <span className={`vanish-badge ${isNextToVanish ? 'next' : ''}`} aria-hidden="true">
                      {isNextToVanish ? '次に消える' : '消える予定'}
                    </span>
                  )}
                </div>
              )}
              {showEvalOverlay && isEmpty && moveEval && (
                <div className={`eval-dot ${getMoveClass(moveEval.value, game.turn)}`}>
                  {moveEval.value !== 0 && <span className="eval-depth">{moveEval.depth}</span>}
                </div>
              )}
              {isHinted && <div className="hint-badge">★</div>}
            </button>
          )
        })}
      </div>

      {/* Move tree */}
      {showMoveTree && evaluation && (
        <div className="move-tree">
          <div className="section-label">
            ゲームツリー — {game.turn === 1 ? 'ほのお' : 'クリスタル'}の選択肢
          </div>
          <div className="move-cards">
            {evaluation.moveEvals.map(me => {
              const cls = getMoveClass(me.value, game.turn)
              const isMax = game.turn === 1
              const bestVal = isMax
                ? Math.max(...evaluation.moveEvals.map(m => m.value))
                : Math.min(...evaluation.moveEvals.map(m => m.value))
              const isBest = me.value === bestVal

              return (
                <button
                  key={me.cell}
                  className={`move-card mc-${cls} ${isBest ? 'best' : ''}`}
                  onClick={() => handleCellClick(me.cell)}
                >
                  <span className="mc-cell">{CELL_NAMES[me.cell]}</span>
                  <span className="mc-result">
                    {cls === 'win' ? '勝ち' : cls === 'lose' ? '負け' : '引分'}
                  </span>
                  {me.value !== 0 && <span className="mc-depth">{me.depth}手</span>}
                  {isBest && <span className="mc-best">最善</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Challenge guide */}
      {gameMode === 'challenge' && game.moveCount === 0 && (
        <div className="challenge-guide">
          <strong>13手必勝チャレンジ</strong>
          <p>先手（ほのお）で完璧な手順を見つけ、13手以内に勝利してください。後手はAIが最善防御を行います。</p>
          <p className="guide-hint">ヒント: 最初の手は辺の中央（上・下・左・右）に。</p>
        </div>
      )}

      {/* Free mode guide */}
      {gameMode === 'free' && game.moveCount === 0 && (
        <div className="challenge-guide">
          <strong>フリープレイ vs {DIFFICULTY_LABELS[difficulty]}AI</strong>
          <p>先手（ほのお）はあなた、後手（クリスタル）はコンピューターです。評価ONで完全解析データに基づく勝敗予測が見られます。</p>
        </div>
      )}

      {/* Controls */}
      <div className="controls">
        {gameMode === 'challenge' && challengeStatus === 'playing' && game.turn === 1 && game.moveCount > 0 && (
          <button className="btn btn-hint" onClick={() => setShowHint(h => !h)}>
            {showHint ? 'ヒント非表示' : 'ヒント'}
          </button>
        )}
        <button className="btn" onClick={reset}>
          {game.winner || challengeStatus === 'failed' ? 'もう一回' : 'リスタート'}
        </button>
        {gameMode === 'free' && (
          <button className={`btn btn-eval ${showEval ? 'active' : ''}`} onClick={() => setShowEval(e => !e)}>
            評価 {showEval ? 'OFF' : 'ON'}
          </button>
        )}
      </div>

      {/* Move history */}
      {game.moveHistory.length > 0 && (
        <div className="history">
          <div className="section-label">棋譜</div>
          <div className="history-moves">
            {game.moveHistory.map((m, i) => (
              <span
                key={i}
                className={`hist-move p${m.player} ${!m.wasOptimal ? 'suboptimal' : ''}`}
                title={`${i + 1}手目: ${m.player === 1 ? 'ほのお' : 'クリスタル'} ${CELL_NAMES[m.cell]}`}
              >
                <span className="move-num">{i + 1}</span>
                <MiniBoard cell={m.cell} player={m.player} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rules */}
      <details className="rules">
        <summary>遊び方</summary>
        <ul>
          <li>交互にマスに駒を置きます</li>
          <li>各プレイヤーは<strong>最大3つ</strong>まで</li>
          <li>4つ目を置くと最も古い駒が消えます（FIFO）</li>
          <li>半透明で点滅している駒が次に消えます</li>
          <li>縦・横・斜めに3つ揃えたら勝ち！</li>
        </ul>
      </details>
    </div>
  )
}

/* ================================================================
   App Root — ページ切り替え
   ================================================================ */

export default function App() {
  const [page, setPage] = useState<Page>('play')

  return (
    <div className="app">
      <header className="app-header">
        <h1>Vanish Tac Toe</h1>
        <p className="subtitle">3つまでしか置けない 新感覚マルバツ</p>
      </header>

      <nav className="page-nav">
        <button
          className={`page-nav-btn ${page === 'play' ? 'active' : ''}`}
          onClick={() => setPage('play')}
        >
          遊ぶ
        </button>
        <button
          className={`page-nav-btn ${page === 'learn' ? 'active' : ''}`}
          onClick={() => setPage('learn')}
        >
          学ぶ
        </button>
      </nav>

      {page === 'play' ? <GamePage /> : <LearnPage />}
    </div>
  )
}
