/**
 * 定时输入归一(纯函数,单测守护)—— 自 GenSettings.tsx 迁出
 * (react-doctor 组件文件只出组件,先例 wsl/portInput.ts)。
 */
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** 定时输入失焦归一:完整 HH:MM 保留;残缺/空串回落最后完整值(而非缺省,
 *  防误输入+失焦无声抹掉原有配置)。 */
export function normalizeTimerTime(v: string, lastValid: string): string {
  return TIME_RE.test(v.trim()) ? v.trim() : lastValid;
}

/** 输入期判定是否完整(完整即刷新「最后完整值」台账)。 */
export function isCompleteTime(v: string): boolean {
  return TIME_RE.test(v);
}
