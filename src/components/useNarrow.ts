// スマホほどの狭い画面か。カードを並べず、名前を並べて一枚だけ出す表示に切り替える。
// サーバでの描画とその直後は広い画面として描く。

import { useEffect, useState } from 'react'

/** styles.css の狭い画面の境目と合わせる */
export const NARROW_QUERY = '(max-width: 560px)'

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return narrow
}
