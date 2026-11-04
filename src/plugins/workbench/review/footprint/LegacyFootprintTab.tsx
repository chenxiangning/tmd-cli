/**
 * 旧 footprint.daily 中央 tab 兼容层(C-02):视图本体已迁「回顾 → 每日足迹」
 * 二级视图;历史遗留 tab(会话恢复/旧深链)经本组件以原 payload 渲染,
 * 不成为未知 tab。C-04 评估随旧插件目录一并退役。
 */
import type { EditorTab } from "@kernel/tabs";
import type { FootprintTabPayload } from "./fpTab";
import { FootprintView } from "./view/FootprintView";

export function LegacyFootprintTab({ tab }: { tab: EditorTab }) {
  return <FootprintView payload={(tab.payload ?? {}) as FootprintTabPayload} />;
}
