// タイトル。相手の強さを選んで CPU と対局を始めるか、オンライン対戦のロビーへ進む。ロゴはこの画面にだけ出す。
// オンライン対戦はまだ試しに出しているので、入口に β の印を付ける。

import { LEVEL_NAMES, type Level } from '../game/cpu'
import { RulesButton } from './RulesButton'

interface Props {
  level: Level
  setLevel: (l: Level) => void
  onStart: () => void
  onOnline: () => void
}

/** 試しに出している機能の印 */
export function Beta() {
  return <span className="beta">β</span>
}

export function Title({ level, setLevel, onStart, onOnline }: Props) {
  return (
    <main className="title">
      <div className="title-help">
        <RulesButton />
      </div>
      <h1 className="title-logo">Duelice</h1>
      <p className="title-lead">3個のダイスを振り、見えている目で読み合う魔術師の決闘</p>
      <fieldset className="level-pick">
        <legend>相手の強さ</legend>
        {(Object.keys(LEVEL_NAMES) as Level[]).map((l) => (
          <label key={l} className={l === level ? 'level-option is-on' : 'level-option'}>
            <input type="radio" name="level" value={l} checked={l === level} onChange={() => setLevel(l)} />
            {LEVEL_NAMES[l]}
          </label>
        ))}
      </fieldset>
      <div className="title-actions">
        <button type="button" className="btn btn-primary btn-large" onClick={onStart}>
          CPU と対戦
        </button>
        <button type="button" className="btn btn-large" onClick={onOnline}>
          オンライン対戦 <Beta />
        </button>
      </div>
    </main>
  )
}
