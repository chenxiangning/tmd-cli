/**
 * 结构化幕布切换钮 —— 幕布右上工具行(terminal.canvasRow 挂点)的插件侧钮。
 * 原独立 lv-float 锚点(top8/right12)并入内核行容器:与幕布刷新钮同排成套,
 * 右缘统一对齐,互不重叠;行不设 z,结构化视图开启时随行隐没。
 * 能力门/模式 store 与 LiveTranscriptOverlay 同源(readSessionTranscript 缺失
 * 不出钮;平铺形态无画布浮层,同样不出,防点击后无处承接)。
 * 点击进入结构化转录视图(liveOverlay 全景),幕布保活零卸载。
 */
import { useEffect, useReducer } from "react";
import { host, useHost } from "@kernel/host";
import { useSessionTabs } from "@kernel/sessionTabs";
import { t } from "@kernel/i18n";
import { setLiveTranscript, isLiveTranscript, subscribeLiveMode } from "./liveMode";

export function LiveTranscriptPill() {
  useHost();
  const { tile } = useSessionTabs();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeLiveMode(force), [force]);
  const activeId = host.getActiveSessionId();
  const meta = activeId ? host.getSessions().find((s) => s.id === activeId) : undefined;
  const profile = meta ? host.getCliProfile(meta.engine ?? meta.profileId) : undefined;
  const capable = !!activeId && meta?.kind !== "shell" && !!profile?.readSessionTranscript;
  if (tile || !capable || isLiveTranscript(activeId)) return null;
  return (
    <button
      type="button"
      className="lv-pill"
      title={t("切换到结构化转录视图(幕布保活)")}
      onClick={() => activeId && setLiveTranscript(activeId, true)}
    >
      {t("结构化幕布")}
    </button>
  );
}
