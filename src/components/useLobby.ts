// ロビーの部屋の一覧。ロビーの WebSocket につなぎ、届いた一覧をそのまま持つ。まだ届いていなければ null。

import { useState } from 'react'
import type { LobbyMessage, LobbyRoom } from '../online/protocol'
import { lobbyPath } from './onlineApi'
import { useSocket } from './useSocket'

export function useLobby(): LobbyRoom[] | null {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null)
  useSocket(lobbyPath, (msg) => {
    const m = msg as LobbyMessage
    if (m.type === 'rooms') setRooms(m.rooms)
  })
  return rooms
}
