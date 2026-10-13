// サーバとの WebSocket。届いた知らせを渡し、知らせを送る。つながりが切れたら、少し待ってつなぎ直す。
// サーバが部屋は無いと閉じたときと、部屋を出て閉じたときは、つなぎ直さない。
// 間に入る機器が黙ったつながりを切らないように、ときどき ping を送る。サーバは Durable Object を起こさずに pong を返す。

import { useCallback, useEffect, useRef } from 'react'
import { socketUrl } from './onlineApi'

/** つなぎ直すまでの間 */
export const RETRY_MS = 1000

/** ping を送る間 */
export const PING_MS = 20_000

/** 閉じた理由がこれなら、つなぎ直さない。ふつうに閉じた、部屋が無い */
const FINAL = new Set([1000, 4404])

/** path が null の間はつながない。送れたら true */
export function useSocket(path: string | null, onMessage: (msg: unknown) => void): (msg: unknown) => boolean {
  const handler = useRef(onMessage)
  useEffect(() => {
    handler.current = onMessage
  })
  const socket = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (path === null) return
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const ping = setInterval(() => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send('ping')
    }, PING_MS)
    const connect = () => {
      const ws = new WebSocket(socketUrl(path))
      socket.current = ws
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(String(e.data)))
        } catch {
          // 読めない知らせは捨てる
        }
      }
      ws.onclose = (e) => {
        if (!stopped && !FINAL.has(e.code)) retry = setTimeout(connect, RETRY_MS)
      }
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(ping)
      const ws = socket.current
      socket.current = null
      if (!ws) return
      ws.onmessage = null
      // つながる前に閉じると、サーバに閉じたことが届かず、つながったままに見えることがある。つながってから閉じる
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close(1000)
      else ws.close(1000)
    }
  }, [path])

  return useCallback((msg: unknown) => {
    const ws = socket.current
    if (ws?.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(msg))
    return true
  }, [])
}
