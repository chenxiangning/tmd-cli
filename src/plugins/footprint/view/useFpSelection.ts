/**
 * footprint 选日/区间动作 hook:anchor 状态 + selectDay/anchorDay/resetSelection。
 * range 归组件所有(useFpData/useFpSearch/useFpKeys 都要消费,且值依赖先于
 * useFpFiles 的 setFileSel —— 本 hook 必须在其后调用,故只收值与 setter);
 * 自 FootprintView 拆出守 300 行铁则与 react-doctor 复杂度(selectDay 的
 * 区间三岔判定是组件体最大控制流块)。
 */
import { useCallback, useState } from "react";
import { t } from "@kernel/i18n";
import type { FpCardView } from "../dataSource";
import type { FileSel } from "./useFpFiles";

export interface FpSelectionDeps {
  range: [string, string] | null;
  setRange: (r: [string, string] | null) => void;
  showToast: (msg: string) => void;
  setSel: (day: string) => void;
  setCard: (c: FpCardView | null) => void;
  setFileSel: (p: FileSel | null) => void;
  setFocusIdx: (i: number) => void;
}

export function useFpSelection({ range, setRange, showToast, setSel, setCard, setFileSel, setFocusIdx }: FpSelectionDeps) {
  const [anchor, setAnchor] = useState<string | null>(null); /* 区间起点(ranging 态左栏提示消费) */

  const selectDay = useCallback(
    (day: string, shift: boolean) => {
      /* 区间中点单日 = 退出区间进当日(原型语义);起点已选时再点任意日 = 完成区间 */
      if (range) {
        setRange(null);
        setAnchor(null);
      } else if (anchor) {
        setRange(anchor <= day ? [anchor, day] : [day, anchor]);
        setAnchor(null);
        setCard(null);
        setFileSel(null);
        setFocusIdx(-1);
        return;
      } else if (shift) {
        setAnchor(day);
        showToast(t("已选区间起点 {day}", { day }));
        return;
      }
      setAnchor(null);
      setSel(day);
      setCard(null);
      setFileSel(null);
      setFocusIdx(-1);
    },
    [range, anchor, setRange, showToast, setSel, setCard, setFileSel, setFocusIdx],
  );

  const anchorDay = useCallback(
    (day: string) => {
      setAnchor(day);
      showToast(t("已选区间起点 {day}", { day }));
    },
    [showToast],
  );

  const resetSelection = useCallback(() => {
    setAnchor(null);
  }, []);

  return { anchor, selectDay, anchorDay, resetSelection };
}
