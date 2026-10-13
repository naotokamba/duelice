// 見る側の入れ替え。対局はサーバでも手元でも席0と席1で持つが、画面はいつも自分を席0として描く。
// オンライン対戦で席1に座った側には、盤と記録の左右を入れ替えて渡す。入れ替えても規則の上で同じ局面になる。

import type { Resolution } from './match'
import type { GameState, Phase, PlayerIndex, StepReport } from './types'

/** 相手の席 */
export const other = (who: PlayerIndex): PlayerIndex => (who === 0 ? 1 : 0)

function swap<T>(pair: readonly [T, T]): [T, T] {
  return [pair[1], pair[0]]
}

/** 攻撃が当たる時の順 */
const PHASES: readonly Phase[] = ['fast', 'main', 'end']

/**
 * 記録の左右を入れ替える。攻撃は、入れ替えた盤で解決したときと同じ順に並べ直す。
 * 当たる時の順に、放った側の席の順に攻撃、その後に、守りが返したダメージを返した先の席の順に並べる
 */
export function flipReport(r: StepReport): StepReport {
  const strikes = r.strikes.map((s) => ({ ...s, from: other(s.from), to: other(s.to) }))
  const bySeat = (list: typeof strikes, seatOf: (s: (typeof strikes)[number]) => PlayerIndex) => [
    ...list.filter((s) => seatOf(s) === 0),
    ...list.filter((s) => seatOf(s) === 1),
  ]
  const ordered = PHASES.flatMap((phase) => {
    const here = strikes.filter((s) => s.phase === phase)
    const attacks = here.filter((s) => s.outcome !== 'returned')
    const returned = here.filter((s) => s.outcome === 'returned')
    return [...bySeat(attacks, (s) => s.from), ...bySeat(returned, (s) => s.to)]
  })
  return {
    ...r,
    actions: swap(r.actions),
    values: swap(r.values),
    strikes: ordered,
    burn: swap(r.burn),
    endBurn: swap(r.endBurn),
    damage: swap(r.damage),
    chants: swap(r.chants),
    cancelled: swap(r.cancelled),
    refunded: swap(r.refunded),
    extra: swap(r.extra),
  }
}

/** 盤の左右を入れ替える。決着も入れ替え、引き分けはそのまま */
export function flipState(s: GameState): GameState {
  return {
    ...s,
    players: swap(s.players),
    history: s.history.map(flipReport),
    winner: s.winner === null || s.winner === 'draw' ? s.winner : other(s.winner),
  }
}

/** who から見た盤。席0ならそのまま、席1なら左右を入れ替える */
export function stateFor(s: GameState, who: PlayerIndex): GameState {
  return who === 0 ? s : flipState(s)
}

/** who から見た解決の結果 */
export function resolutionFor(r: Resolution, who: PlayerIndex): Resolution {
  return who === 0 ? r : { state: flipState(r.state), report: flipReport(r.report) }
}
