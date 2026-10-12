// タイトル。相手の強さを選んで対局を始める。ロゴはこの画面にだけ出す。

import { LEVEL_NAMES, type Level } from '../game/cpu'
import { RulesButton } from './RulesButton'

interface Props {
  level: Level
  setLevel: (l: Level) => void
  onStart: () => void
}

export function Title({ level, setLevel, onStart }: Props) {
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
      <button type="button" className="btn btn-primary btn-large" onClick={onStart}>
        決闘を始める
      </button>
    </main>
  )
}
