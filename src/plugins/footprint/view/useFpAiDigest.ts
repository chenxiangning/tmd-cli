/**
 * footprint 「AI 补归纳」hook:入队工作台日报生成会话(功能卡随文直写)。
 * 自 FootprintView 拆出守组件复杂度。静态依赖安全:genRequest 链上
 * (journalStore/journalFiles/taskQueue)不回流 footprint,无模块环。
 */
import { useCallback, useRef } from "react";
import { t } from "@kernel/i18n";
import { requestDayGenerate } from "@plugins/workbench/journal/genRequest";

export function useFpAiDigest({ sel, showToast }: { sel: string; showToast: (msg: string) => void }) {
  /* 忙守卫只服务回调自身、不参与渲染,用 ref 免多余重渲。 */
  const busyRef = useRef(false);
  return useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    void requestDayGenerate(sel)
      .then((ok) => showToast(ok ? t("已入队日报生成:功能卡随文落盘,完成后自动刷新") : t("该日已有生成任务在队列")))
      .catch(() => showToast(t("日报生成模块未就绪")))
      .finally(() => { busyRef.current = false; });
  }, [sel, showToast]);
}
