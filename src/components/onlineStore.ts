// オンライン対戦で、ブラウザに覚えておくもの。名前は次に入るときの既定に、部屋の席の合言葉は再読み込みで同じ席に戻るのに使う。
// 覚えられない画面でも遊べるように、読み書きに失敗したら覚えていないものとして続ける。

/** 部屋の名前と、その部屋の自分の席の合言葉 */
export interface Session {
  id: string
  token: string
}

const NAME_KEY = 'duelice.name'
const ROOM_KEY = 'duelice.room'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 覚えられなくても遊べる
  }
}

export const loadName = (): string => read(NAME_KEY) ?? ''
export const saveName = (name: string) => write(NAME_KEY, name)

export function loadSession(): Session | null {
  try {
    const raw = JSON.parse(read(ROOM_KEY) ?? 'null') as Partial<Session> | null
    return typeof raw?.id === 'string' && typeof raw.token === 'string' ? { id: raw.id, token: raw.token } : null
  } catch {
    return null
  }
}
export const saveSession = (s: Session) => write(ROOM_KEY, JSON.stringify(s))
export const clearSession = () => write(ROOM_KEY, null)

/** 部屋を作るときの合言葉の既定。半角数字4桁 */
export function randomCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 10_000)).padStart(4, '0')
}

/** 入れた合言葉を、全角の数字は半角に直し、数字のほかは除いて、4桁までにする */
export function codeInput(raw: string): string {
  return raw
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, 4)
}
