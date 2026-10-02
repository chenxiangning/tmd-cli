/**
 * 结构化视图切换钮 —— 幕布右上工具行(terminal.canvasRow 挂点)的插件侧钮。
 * 原独立 lv-float 锚点(top8/right12)并入内核行容器:与幕布刷新钮同排成套,
 * 右缘统一对齐,互不重叠;行不设 z,结构化视图开启时随行隐没。
 * 能力门/模式 store 与 LiveTranscriptOverlay 同源(readSessionTranscript 缺失
 * 不出钮;kimi/grok 目录型与 opencode/dsh 合成型路径恒探错,同样不出,防点击后
 * 无处承接;平铺形态无画布浮层,同样不出)。
 * 点击进入结构化视图(liveOverlay 全景),幕布保活零卸载。
 * 命名契约:入口「结构化视图」/ 出口「PTY实况」,两面一致(0.2.7 打磨收敛)。
 */
import { useEffect, useReducer } from "react";
import { host, useHost } from "@kernel/host";
import { useSessionTabs } from "@kernel/sessionTabs";
import { t } from "@kernel/i18n";
import { setLiveTranscript, isLiveTranscript, subscribeLiveMode, pillCapable } from "./liveMode";

export function LiveTranscriptPill() {
  useHost();
  const { tile } = useSessionTabs();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeLiveMode(force), [force]);
  const activeId = host.getActiveSessionId();
  const meta = activeId ? host.getSessions().find((s) => s.id === activeId) : undefined;
  const profile = meta ? host.getCliProfile(meta.engine ?? meta.profileId) : undefined;
  /* 能力门收紧:除转录读取器外,kimi/grok(目录型)与 opencode/dsh(合成型)
   * 的磁盘路径永远探错(liveMode.pillCapable 熔断名单),不出钮。 */
  const capable = !!activeId && meta?.kind !== "shell" && pillCapable(profile?.id, !!profile?.readSessionTranscript);
  if (tile || !capable || isLiveTranscript(activeId)) return null;
  return (
    <button
      type="button"
      className="lv-pill"
      title={t("切换到结构化视图(幕布保活,只读转录)")}
      onClick={() => activeId && setLiveTranscript(activeId, true)}
    >
      {t("结构化视图")}
    </button>
  );
}
