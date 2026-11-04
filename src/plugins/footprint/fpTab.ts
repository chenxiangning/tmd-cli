/**
 * footprint —— C-02 迁移期兼容封装(旧 @plugins/footprint/fpTab 消费方零迁移)。
 *
 * 本体已迁入 workbench/review/footprint(C-02):openFootprintTab 在迁移期
 * 转发「回顾 → 每日足迹」宿主(reviewTabs.openWorkbenchReviewTab),旧深链
 * 行为(payload.day 直达/refresh 重开)由回顾壳承接。本文件纯 re-export,
 * C-04 随旧插件目录一并退役。
 */
export {
  FP_TAB_KIND,
  FP_TAB_ID,
  bumpFootprintRev,
  useFootprintRev,
  fpYmOfDay,
  fpInitView,
  gotoToday,
  openFootprintTab,
} from "../workbench/review/footprint/fpTab";
export type { FootprintTabPayload } from "../workbench/review/footprint/fpTab";
