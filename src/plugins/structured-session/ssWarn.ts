/**
 * 告警胶囊多槽 hook(评审 P3 修复)—— 帧丢弃/启动 stderr/历史转录不可读
 * (B2-2)各占一槽,去重追加:先到不挤占后到(原单槽 warn 先到者永久遮蔽
 * 其余告警);逐槽可关(startSession/retry 时整组清空)。看门狗已迁
 * StallBanner 常驻横幅(B2-1),不再占槽。
 */
import { useState } from "react";

export function useWarnCapsules(): {
  warns: string[];
  addWarn: (text: string) => void;
  dismissWarn: (index: number) => void;
  clearWarns: () => void;
} {
  const [warns, setWarns] = useState<string[]>([]);
  const addWarn = (text: string) => setWarns((ws) => (ws.includes(text) ? ws : [...ws, text]));
  const dismissWarn = (index: number) => setWarns((ws) => ws.filter((_, i) => i !== index));
  const clearWarns = () => setWarns([]);
  return { warns, addWarn, dismissWarn, clearWarns };
}
