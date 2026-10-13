// @vitest-environment happy-dom
// ブラウザに覚えるものと、合言葉の入れ方。覚えられない画面でも止まらない。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { socketUrl } from './onlineApi'
import { clearSession, codeInput, loadName, loadSession, randomCode, saveName, saveSession } from './onlineStore'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('覚えるもの', () => {
  it('名前と部屋の席を覚え、忘れる', () => {
    expect(loadName()).toBe('')
    saveName('あお')
    expect(loadName()).toBe('あお')
    expect(loadSession()).toBeNull()
    saveSession({ id: 'room0001', token: 't' })
    expect(loadSession()).toEqual({ id: 'room0001', token: 't' })
    clearSession()
    expect(loadSession()).toBeNull()
  })

  it('読めない席は覚えていないものとする', () => {
    for (const raw of ['{', 'null', '{"id":"a"}', '{"id":"a","token":1}']) {
      localStorage.setItem('duelice.room', raw)
      expect(loadSession()).toBeNull()
    }
  })

  it('覚えられない画面でも止まらない', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadName()).toBe('')
    expect(loadSession()).toBeNull()
    expect(() => saveName('あお')).not.toThrow()
  })
})

describe('合言葉', () => {
  it('既定は乱数から作る半角数字4桁', () => {
    expect(randomCode(() => 0)).toBe('0000')
    expect(randomCode(() => 0.99999)).toBe('9999')
    expect(randomCode(() => 0.0421)).toBe('0421')
  })

  it('全角の数字は半角に直し、数字のほかは除き、4桁までにする', () => {
    expect(codeInput('１２３４')).toBe('1234')
    expect(codeInput('1a2 3-4 5')).toBe('1234')
    expect(codeInput('')).toBe('')
  })
})

describe('WebSocket の行き先', () => {
  it('https の画面からは wss でつなぐ', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'duelice.example' })
    expect(socketUrl('/api/lobby')).toBe('wss://duelice.example/api/lobby')
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' })
    expect(socketUrl('/api/lobby')).toBe('ws://localhost:3000/api/lobby')
  })
})
