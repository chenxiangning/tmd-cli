/**
 * 本地文件 tab 的关闭前闸(kind="file" 的 beforeClose)。
 *
 * 为什么不随 tab 组件渲染闸体:文件 tab 非 keepAlive(EditorCenter 切走即卸载),
 * 「脏 tab 未激活」时组件不在挂,journal 那套「tab 在挂 = 闸在」的形态对它不成立
 * —— 改走 kernel askDialog 命令式确认,可用性与任何组件的挂载时机无关。
 *
 * 判据 = kernel tab 的 dirty(useFileDocument 经 updateTab 镜像的脏圆点)。
 * 「丢弃」必须 draftDelete:草稿在内存缓存(draftSet),只关 tab 不删草稿的话,
 * 重开同文件草稿原地复活 —— 弹窗说「将丢失」就得真丢。
 */
import type { EditorTab } from "@kernel/tabs";
import { askDialog } from "@kernel/askDialog";
import { t } from "@kernel/i18n";
import { draftDelete } from "./editor/fileCache";

export function fileBeforeClose(tab: EditorTab): Promise<boolean> {
  if (!tab.dirty) return Promise.resolve(true);
  return askDialog({
    title: t("未保存的修改"),
    message: t("未保存的修改将丢失"),
    confirmLabel: t("丢弃"),
    danger: true,
  }).then((ok) => {
    if (ok) draftDelete(tab.path);
    return ok;
  });
}
