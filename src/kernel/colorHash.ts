/**
 * string→hue 稳定散列(通用原语):分支标注/工作区分支 label/历史作者头像
 * 共用同一公式,同串恒同色(浅色主题经 color-mix 混 fg 保证可读)。
 * 改公式 = 全局换色,跨处一致性靠本文件单点保证,禁止旁处复写。
 */
export function stringHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
