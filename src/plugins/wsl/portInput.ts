/**
 * 端口严格校验(纯函数,单测守护)—— 自 HostForm.tsx 迁出(react-doctor
 * 组件文件只出组件):纯数字串 + 1-65535,其余一律拒。
 * 此前 parseInt 放行 "22abc"/"0x16"/" 22 ",静默落库毒配置。
 */
export function parsePort(raw: string): number | null {
  const v = raw.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}
