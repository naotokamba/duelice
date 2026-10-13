// ロビーの中身と、部屋を作る、入るときの中身の確かめ方のテスト。

import { describe, expect, it } from 'vitest'
import type { LobbyRoom } from '../online/protocol'
import { parseCreate, parseJoin, roomIdFrom, validRoomId } from './api'
import { dropRoom, listRooms, putRoom } from './lobby'

const room = (id: string, createdAt: number, status: LobbyRoom['status'] = 'waiting'): LobbyRoom => ({
  id,
  host: id.toUpperCase(),
  status,
  createdAt,
})

describe('ロビーの一覧', () => {
  it('部屋を足し、書き換え、消す。元の一覧は変えない', () => {
    const empty = {}
    const one = putRoom(empty, room('a', 1))
    expect(empty).toEqual({})
    const playing = putRoom(one, room('a', 1, 'playing'))
    expect(listRooms(playing)).toEqual([room('a', 1, 'playing')])
    expect(listRooms(dropRoom(playing, 'a'))).toEqual([])
    expect(listRooms(dropRoom(playing, 'b'))).toEqual([room('a', 1, 'playing')])
  })
  it('新しく作った部屋を上に出す。同じ時刻なら名前の順', () => {
    const rooms = [room('b', 1), room('c', 3), room('a', 1)].reduce(putRoom, {})
    expect(listRooms(rooms).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('部屋の名前', () => {
  it('乱数から英小文字と数字の8文字を作る', () => {
    const id = roomIdFrom([0, 0.5, 0.9999, 0.1, 0.2, 0.3, 0.4, 0.6])
    expect(id).toBe('as9dhkov')
    expect(roomIdFrom([0, 0, 0, 0, 0, 0, 0, 0.9999])).toBe('aaaaaaa9')
    expect(validRoomId(id)).toBe(true)
  })
  it('形の違う名前は通さない', () => {
    for (const id of ['', 'abc', 'ABCDEFGH', 'abcdefg_', 'abcdefghi', '../lobby']) expect(validRoomId(id)).toBe(false)
  })
})

describe('部屋に入るときの中身', () => {
  it('名前の前後の空白を除き、合言葉は半角数字4桁だけ通す', () => {
    expect(parseJoin({ name: ' あお ', code: '0123' })).toEqual({ name: 'あお', code: '0123' })
    for (const body of [
      null,
      'x',
      {},
      { name: 'a' },
      { name: 'a', code: 1234 },
      { name: 1, code: '1234' },
      { name: '   ', code: '1234' },
      { name: 'あ'.repeat(13), code: '1234' },
      { name: 'a', code: '123' },
      { name: 'a', code: '１２３４' },
    ]) {
      expect(parseJoin(body)).toBeNull()
    }
  })
  it('名前は12文字まで', () => {
    expect(parseJoin({ name: 'あ'.repeat(12), code: '1234' })?.name).toBe('あ'.repeat(12))
  })
})

describe('部屋を作るときの中身', () => {
  const body = { name: 'あお', code: '1234', stepMs: 3000, hp: 4 }

  it('本番では、テストのための持ち時間と体力を無視する', () => {
    expect(parseCreate(body, false)).toEqual({ name: 'あお', code: '1234' })
  })
  it('開発のときだけ、テストのための持ち時間と体力を受け付ける', () => {
    expect(parseCreate(body, true)).toEqual({
      name: 'あお',
      code: '1234',
      stepMs: 3000,
      config: { maxHp: 4, diceCount: 3 },
    })
  })
  it('開発のときでも、正の整数でなければ無視する', () => {
    expect(parseCreate({ ...body, stepMs: -1, hp: 1.5 }, true)).toEqual({ name: 'あお', code: '1234' })
    expect(parseCreate({ ...body, stepMs: '3000', hp: 0 }, true)).toEqual({ name: 'あお', code: '1234' })
    expect(parseCreate({ ...body, stepMs: 0, hp: '4' }, true)).toEqual({ name: 'あお', code: '1234' })
  })
  it('名前か合言葉が正しくなければ作らない', () => {
    expect(parseCreate({ name: '', code: '1234' }, true)).toBeNull()
  })
})
