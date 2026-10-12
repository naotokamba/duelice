// 体力の帯と数。席と公開の幕の両方で使う。0 より下は 0 と見せる。

export function HpBar({ hp, maxHp, withMax }: { hp: number; maxHp: number; withMax?: boolean }) {
  const shown = Math.max(0, hp)
  return (
    <>
      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${(shown / maxHp) * 100}%` }} />
      </div>
      <span className="hp-num">
        {shown}
        {withMax && <small> / {maxHp}</small>}
      </span>
    </>
  )
}
