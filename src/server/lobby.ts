// ロビーの中身。部屋の一覧を、部屋から届いた知らせで書き換える純粋な関数だけを置く。
// Durable Object の殻 lobby-object.ts は、これを呼んで保存し、つながっている画面に一覧を送るだけにする。

import type { LobbyRoom } from '../online/protocol'

export type Rooms = Record<string, LobbyRoom>

/** 部屋の一行を足すか書き換える */
export function putRoom(rooms: Rooms, room: LobbyRoom): Rooms {
  return { ...rooms, [room.id]: room }
}

/** 部屋の一行を消す */
export function dropRoom(rooms: Rooms, id: string): Rooms {
  const { [id]: _, ...rest } = rooms
  return rest
}

/** 画面に出す順。新しく作った部屋を上にする */
export function listRooms(rooms: Rooms): LobbyRoom[] {
  return Object.values(rooms).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}
