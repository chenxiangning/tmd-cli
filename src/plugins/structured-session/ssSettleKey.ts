/**
 * 结算换装 key hook:turnLive 跌落沿(宽限结算)记录本轮首块(= 最后 user 块)
 * id,SsTurnView 据此给该轮折叠组播一次「展开→收起」过渡。渲染期 setState
 * 模式(React 文档 adjust-state-on-prop-change):首帧即带 key 挂载,折叠组
 * mount 时 enterOpen 即真。
 */
import { useState } from "react";
import type { CliTranscriptBlock } from "@kernel/cli";

export function useSettleKey(turnLive: boolean, blocks: CliTranscriptBlock[]): string | null {
  const [snap, setSnap] = useState<{ wasLive: boolean; key: string | null }>({ wasLive: false, key: null });
  if (snap.wasLive !== turnLive) {
    const fell = snap.wasLive && !turnLive;
    const lastUser = fell ? [...blocks].reverse().find((b) => b.role === "user") : undefined;
    setSnap({ wasLive: turnLive, key: fell ? (lastUser?.id ?? null) : snap.key });
  }
  return snap.key;
}
