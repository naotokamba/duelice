// 公開の演出の時計。解決の結果を受け取り、矢印が当たる時刻ごとに当たった分を進め、動きが終わったら公開を閉じる。
// 対局はもう先へ進んでいて、ここで扱うのは見せ方だけ。時間の長さは Exchange.tsx の定数から決める。
// 卓は対局ごとに作り直すので、時計も対局の初めの状態から始まり、最初のターンを知らせる。

import { useEffect, useState } from 'react'
import type { Resolution } from '../game/match'
import type { PlayerIndex, StepReport } from '../game/types'
import { BLOOD_MS, IMPACT_MS, landings, revealMs } from './Exchange'

/** ステップやターンの切り替わりを知らせる帯を出す時間 */
export const BANNER_MS = 1100

export interface Banner {
  text: string
  /** 新しいターン。ダイスを振る動きを付ける */
  turn: boolean
}

/**
 * 公開してから landed ミリ秒目まででは、まだ入っていない who へのダメージ。その分だけ体力を多く見せる。
 * 攻撃が当たる分と、血として払う分を数える
 */
export function unlanded(report: StepReport, who: PlayerIndex, landed: number): number {
  const hits = IMPACT_MS > landed ? report.strikes.filter((s) => s.to === who).reduce((sum, s) => sum + s.dealt, 0) : 0
  return hits + (BLOOD_MS > landed ? report.blood[who] : 0)
}

export function useRevealClock() {
  /** 公開している最中の解決。動きが終わると null に戻り、次のステップの盤を見せる */
  const [reveal, setReveal] = useState<Resolution | null>(null)
  /** 公開してから、何ミリ秒目までの攻撃が当たったか */
  const [landed, setLanded] = useState(Number.POSITIVE_INFINITY)
  /** 決着した公開の動きが終わった。勝敗はそれから出す */
  const [ended, setEnded] = useState(false)
  const [banner, setBanner] = useState<Banner | null>({ text: 'Turn 1', turn: true })

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

  return {
    reveal,
    ended,
    banner,
    /** 公開の途中なら、まだ当たっていないダメージ */
    unlanded: (who: PlayerIndex) => (reveal ? unlanded(reveal.report, who, landed) : 0),
    /** 詠唱の結果は、矢印が当たるまで伏せる */
    quiet: reveal !== null && landed < IMPACT_MS,
    /** 解決の結果の公開を始める */
    play: (r: Resolution) => {
      setReveal(r)
      setLanded(0)
      setBanner(null)
    },
  }
}
