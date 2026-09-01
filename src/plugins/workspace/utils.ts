/** 会话 id 短显:UUIDv7 类 id 前 8 位是时间戳,近缘会话必然撞前缀 → 头 4 + 尾 4。 */
export function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}
