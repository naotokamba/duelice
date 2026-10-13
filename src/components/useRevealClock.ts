// 公開の演出の時計。新しい解決が届いたら公開を始め、矢印が当たる時刻ごとに当たった分を進め、動きが終わったら公開を閉じる。
// 対局はもう先へ進んでいて、ここで扱うのは見せ方だけ。時間の長さは Exchange.tsx の定数から決める。
// 卓は対局ごとに作り直すので、時計も対局の初めの状態から始まり、対局の初めなら最初のターンを知らせる。

import { useEffect, useLayoutEffect, useState } from 'react'
import type { Resolution } from '../game/match'
import type { PlayerIndex, StepReport } from '../game/types'
import { BURN_MS, IMPACT_MS, landings, revealMs } from './Exchange'

/** ステップやターンの切り替わりを知らせる帯を出す時間 */
export const BANNER_MS = 1100

export interface Banner {
  text: string
  /** 新しいターン。ダイスを振る動きを付ける */
  turn: boolean
}

/**
 * 公開してから landed ミリ秒目まででは、まだ入っていない who へのダメージ。その分だけ体力を多く見せる。
 * 攻撃が当たる分と、自分が焼ける分を数える
 */
export function unlanded(report: StepReport, who: PlayerIndex, landed: number): number {
  const hits = IMPACT_MS > landed ? report.strikes.filter((s) => s.to === who).reduce((sum, s) => sum + s.dealt, 0) : 0
  return hits + (BURN_MS > landed ? report.burn[who] : 0)
}

/** 対局で n 回目の解決 */
export interface Resolved {
  n: number
  resolution: Resolution
}

/**
 * resolved の n が前より増えたら、その解決を公開する。時計を作ったときに届いていた解決は、もう公開したものとして扱う。
 * 再読み込みして戻った卓で、前の公開を繰り返さないため。opening なら、最初のターンを知らせる
 */
export function useRevealClock(resolved: Resolved | null, opening: boolean) {
  /** 公開を始めた解決の番号 */
  const [seen, setSeen] = useState(resolved?.n ?? 0)
  /** 公開している最中の解決。動きが終わると null に戻り、次のステップの盤を見せる */
  const [reveal, setReveal] = useState<Resolution | null>(null)
  /** 公開してから、何ミリ秒目までの攻撃が当たったか */
  const [landed, setLanded] = useState(Number.POSITIVE_INFINITY)
  /** 決着した公開の動きが終わった。勝敗はそれから出す */
  const [ended, setEnded] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(opening ? { text: 'Turn 1', turn: true } : null)

  /** 届いたが、まだ公開を始めていない解決。始めるまでの一度の描画でも、解決した直後の盤を見せる */
  const fresh = resolved !== null && resolved.n > seen ? resolved.resolution : null

  // 画面に出す前に公開を始め、先へ進んだ盤が一瞬見えないようにする
  useLayoutEffect(() => {
    if (!resolved || resolved.n <= seen) return
    setSeen(resolved.n)
    setReveal(resolved.resolution)
    setLanded(0)
    setBanner(null)
  }, [resolved, seen])

  useEffect(() => {
    if (!reveal) return
    const { report } = reveal
    const timers = [...new Set(landings(report))].map((t) => setTimeout(() => setLanded(t), t))
    timers.push(
      setTimeout(() => {
        setLanded(Number.POSITIVE_INFINITY)
        if (reveal.state.winner !== null) {
          setEnded(true)
          return
        }
        const turn = report.step === 2
        setReveal(null)
        setBanner({ text: turn ? `Turn ${report.turn + 1}` : 'Step 2', turn })
      }, revealMs(report)),
    )
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [reveal])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), BANNER_MS)
    return () => clearTimeout(t)
  }, [banner])

  const showing = fresh ?? reveal
  const at = fresh ? 0 : landed
  return {
    reveal: showing,
    ended,
    banner: fresh ? null : banner,
    /** 公開の途中なら、まだ当たっていないダメージ */
    unlanded: (who: PlayerIndex) => (showing ? unlanded(showing.report, who, at) : 0),
    /** 詠唱の結果は、矢印が当たるまで伏せる */
    quiet: showing !== null && at < IMPACT_MS,
  }
}
