// 評価の道具を node で直接動かすための、読み込みの手助け。
// 対局の中身 src/game は拡張子を書かずに読み合うので、見つからなければ .ts を足して探す。型は node が取り除く。

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (e) {
    if (!specifier.startsWith('.') || specifier.endsWith('.ts')) throw e
    return next(`${specifier}.ts`, context)
  }
}
