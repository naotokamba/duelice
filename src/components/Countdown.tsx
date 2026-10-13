// 持ち時間の残り。オンライン対戦の今のステップの残りを秒で出す。押せるものではないので動かさず、残りが少なくなったら色だけを変える。

import { Timer } from 'lucide-react'
import { useEffect, useState } from 'react'

/** 残りがこの秒数以下になったら色を変える */
export const HURRY_S = 10

/** 画面の時計の今の時刻。every ミリ秒ごとに読み直す */
function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

/**
 * deadline は画面の時計で直した期限。公開の猶予の間は持ち時間の満了を出したまま止め、猶予が過ぎてから減らす
 */
export function Countdown({ deadline, stepMs }: { deadline: number; stepMs: number }) {
  const now = useNow(250)
  const left = Math.max(0, Math.min(Math.ceil(stepMs / 1000), Math.ceil((deadline - now) / 1000)))
  return (
    <span className={left <= HURRY_S ? 'countdown is-hurry' : 'countdown'} role="timer" aria-label={`残り ${left} 秒`}>
      <Timer aria-hidden="true" />
      <span aria-hidden="true">{left}</span>
    </span>
  )
}
