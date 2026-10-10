import itertools, collections, functools, sys
import numpy as np
from scipy.optimize import linprog

# 使い方: python3 solve9.py 五枚目(none/twin/mirror) 双子の呪の点
FIFTH = sys.argv[1]; TWIN = int(sys.argv[2]) if len(sys.argv) > 2 else 5
M1, M2 = 2, 3

def actions(rem, used, step):
    acts = [('P', ())]
    rem = tuple(rem)
    pairs = set(itertools.combinations(rem, 2)) if len(rem) >= 2 else set()
    if 'F' not in used:
        for c in pairs: acts.append(('F', tuple(sorted(c))))
    if 'B' not in used:
        for v in set(rem): acts.append(('B', (v,)))
    if 'M' not in used:
        for v in set(rem): acts.append(('M', (v,)))
        for c in pairs: acts.append(('M', tuple(sorted(c))))
    if step == 1 and 'L' not in used:
        for v in set(rem): acts.append(('L', (v,)))
    if step == 2 and 'Lc' in used:
        for c in pairs: acts.append(('X', tuple(sorted(c))))
    if FIFTH == 'twin' and 'T' not in used:
        for c in pairs:
            if c[0] == c[1]: acts.append(('T', c))
    if FIFTH == 'mirror' and 'R' not in used:
        for c in pairs:
            if c[0] == c[1]: acts.append(('R', c))
    return sorted(set(acts))

def remove(rem, dice):
    r = list(rem)
    for d in dice: r.remove(d)
    return tuple(sorted(r))

def raw(a, b):
    """aがbに与える素のダメージ（障壁込み、鏡は別処理）"""
    card, dice = a
    barrier = b[1][0] if b[0] == 'B' else 0
    if card == 'F': return max(0, max(dice) - barrier)
    if card == 'X': return max(0, sum(dice) - barrier)
    if card == 'T': return max(0, TWIN - barrier)
    if card == 'M': return M1 if len(dice) == 1 else M2
    return 0

def outcome(a, b):
    """(aが受けるダメージ, bが受けるダメージ)"""
    ab = raw(a, b); ba = raw(b, a)
    take_a, take_b = ba, ab
    if b[0] == 'R':  # bの鏡がaの攻撃を返す
        take_b -= ab; take_a += ab
    if a[0] == 'R':
        take_a -= ba; take_b += ba
    return take_a, take_b

def net(a, b):
    ta, tb = outcome(a, b)
    return tb - ta

def after1(a, b):
    if a[0] == 'P': return frozenset()
    if a[0] == 'L':
        took = outcome(a, b)[0]
        return frozenset(['L', 'Lc']) if took < a[1][0] else frozenset(['L'])
    return frozenset([a[0]])

def solve(M):
    M = np.asarray(M, dtype=float)
    def lp(A):
        mm, nn = A.shape
        c = np.zeros(mm + 1); c[-1] = -1
        res = linprog(c, A_ub=np.hstack([-A.T, np.ones((nn, 1))]), b_ub=np.zeros(nn),
                      A_eq=np.hstack([np.ones((1, mm)), np.zeros((1, 1))]), b_eq=[1],
                      bounds=[(0, None)] * mm + [(None, None)], method='highs')
        return res.x[-1], res.x[:-1]
    v, x = lp(M); _, y = lp(-M.T)
    return v, x, y

@functools.lru_cache(maxsize=None)
def step2(remA, usedA, remB, usedB):
    A = actions(remA, usedA, 2); B = actions(remB, usedB, 2)
    v, x, y = solve([[net(a, b) for b in B] for a in A])
    return v, tuple(A), tuple(x), tuple(B), tuple(y)

def nxt(roll, a, b): return remove(roll, a[1]), after1(a, b)

@functools.lru_cache(maxsize=None)
def step1(ra, rb):
    A = actions(ra, frozenset(), 1); B = actions(rb, frozenset(), 1)
    v, x, y = solve([[net(a, b) + step2(*nxt(ra, a, b), *nxt(rb, b, a))[0] for b in B] for a in A])
    return v, A, x, B, y

def topcard(A, x):
    d = collections.Counter()
    for a, p in zip(A, x): d[a[0]] += p
    return d.most_common(1)[0]

rolls = collections.Counter(tuple(sorted(r)) for r in itertools.product(range(1, 7), repeat=3))
total = 216 * 216
nm = {'F': '火球', 'B': '障壁', 'M': '魔弾', 'P': '何もしない', 'L': '雷槍詠唱', 'X': '雷槍発動', 'T': '双子の呪', 'R': '鏡写し'}
f1 = collections.Counter(); f2 = collections.Counter(); pat = collections.Counter()
dmg = 0; big = 0; forced = 0; forced_low = 0; Lok = 0; Lbreak = 0
pairturn_use = 0; pairturn = 0
for ra, wa in rolls.items():
    for rb, wb in rolls.items():
        w = wa * wb / total
        v, A, x, B, y = step1(ra, rb)
        c1, p1 = topcard(A, x)
        is_forced = p1 > 0.99
        haspair = len(set(ra)) < 3
        if haspair: pairturn += w
        for i, a in enumerate(A):
            if x[i] < 1e-9: continue
            f1[a[0]] += w * x[i]
            if haspair and a[0] in ('T', 'R'): pairturn_use += w * x[i]
            for j, b in enumerate(B):
                if y[j] < 1e-9: continue
                pij = w * x[i] * y[j]
                (rA, uA), (rB, uB) = nxt(ra, a, b), nxt(rb, b, a)
                if a[0] == 'L':
                    if 'Lc' in uA: Lok += pij
                    else: Lbreak += pij
                _, A2, x2, B2, y2 = step2(rA, uA, rB, uB)
                c2, p2 = topcard(A2, x2)
                if x[i] > 0.01 and p2 <= 0.99: is_forced = False
                for k, a2 in enumerate(A2):
                    if x2[k] < 1e-9: continue
                    pk = pij * x2[k]
                    f2[a2[0]] += pk; pat[(a[0], a2[0])] += pk
                    if a2[0] in ('T', 'R') and haspair: pairturn_use += pk
                    for l, b2 in enumerate(B2):
                        p = pk * y2[l]
                        if p < 1e-12: continue
                        d = outcome(a, b)[0] + outcome(a2, b2)[0]
                        dmg += p * d
                        if d >= 10: big += p
        if is_forced:
            forced += w
            if max(ra) <= 3: forced_low += w

print('五枚目', {'none': 'なし', 'twin': f'双子の呪 {TWIN}点', 'mirror': '鏡写し'}[FIFTH])
print(' ステップ1', {nm[k]: round(float(v), 3) for k, v in f1.most_common()})
print(' ステップ2', {nm[k]: round(float(v), 3) for k, v in f2.most_common() if v > 0.001})
print(' 流れ上位', [(nm[a] + '→' + nm[b], round(float(p), 3)) for (a, b), p in pat.most_common(7)])
print(' 詠唱率', round(Lok + Lbreak, 3), ' 詠唱が通る率', round(Lok / max(1e-9, Lok + Lbreak), 3))
print(' 両ステップ一択', round(forced, 4), ' うち自分の目が全部3以下', round(forced_low, 4))
print(' ゾロ目のあるターンで五枚目を使う割合', round(pairturn_use / pairturn, 3) if FIFTH != 'none' else '-')
print(' 1ターン平均被ダメ', round(dmg, 2), ' 10以上', round(big, 3))
