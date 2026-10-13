// node --import で読み、hooks.mjs の読み込みの手助けを登録する
import { register } from 'node:module'

register('./hooks.mjs', import.meta.url)
