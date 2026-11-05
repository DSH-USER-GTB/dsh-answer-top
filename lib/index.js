/**
 * dsh-answer-top —— 宿主侧
 *
 * 纯空占位插件：bundle 行需要一个宿主侧条目才能挂载，
 * 但本插件的全部逻辑都在浏览器端（lib/client.js）。
 *
 * 约束：
 *   - 不 import 任何 node 内置模块（不再写磁盘）
 *   - apply() 为空实现
 */

export const name = "dsh-answer-top";

export function apply(_ctx) {}
