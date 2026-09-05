/**
 * composer 插件入口 —— 挂 editorCenter.composer,提供 Composer 视图。
 *
 * v1 实现基线:
 * - textarea + Enter 发送 / Shift+Enter 换行
 * - 走 CLI profile 的 translate 钩子(如 omp 的 $skill → /skill:skill)
 * - Step 4 在此基础上增加触发器下拉 / Step 5 增加拖拽 + 截图
 * - 快捷键(spec 2026-09-05):⌘K 开合命令抽屉;发送与抽屉 plugin 区条目以无键位命令暴露
 */

import { SquarePen } from "lucide-react";
import { host } from "@kernel/host";
import type { Plugin } from "@kernel/plugin";
import { Composer, composerSendRef } from "./view/Composer";
import { ComposerToolbar } from "./view/ComposerToolbar";
import { toggleDrawer } from "./state/drawerOpen";
import { pluginDrawerCommands } from "./drawerItems";

/* ⌘K 按住不放的自动重复抑制:命令 run 无事件面(拿不到 e.repeat),
   以「触发即挂起、键抬起重新武装」等价模拟原监听的 e.repeat 判断;
   窗口失焦丢 keyup 时兜底复位(否则吞下一次触发)。 */
let drawerKeyHeld = false;
function onDrawerKeyRelease(e: KeyboardEvent): void {
  if (e.key.toLowerCase() === "k") drawerKeyHeld = false;
}
function rearmDrawerKey(): void {
  drawerKeyHeld = false;
}
function toggleDrawerIgnoreRepeat(): void {
  if (drawerKeyHeld) return;
  drawerKeyHeld = true;
  toggleDrawer();
}

export const composerPlugin: Plugin = {
  id: "composer",
  meta: {
    name: "输入区",
    abbr: "CP",
    desc: "Composer:富文本输入、附件、建议",
    icon: SquarePen,
    iconColor: "#A78BFA",
    category: "core",
  },
  activate(ctx) {
    ctx.contribute("editorCenter.composer", {
      order: 0,
      component: Composer,
    });
    ctx.contribute("composer.statusBar", {
      order: 0,
      component: ComposerToolbar,
    });
    // 额度以 QuotaChip 内嵌 ComposerToolbar(模型/思考 同一行),不再独立卡片。

    /* ⌘K 开合命令抽屉(原 Composer 内 document keydown 监听收编,行为不变):
       活跃会话门控放 when(不满足 = 键穿透);keyup/blur 伴听服务于重复抑制,deactivate 摘除 */
    document.addEventListener("keyup", onDrawerKeyRelease);
    window.addEventListener("blur", rearmDrawerKey);
    ctx.registerCommand({
      id: "composer.toggleDrawer",
      title: "打开/关闭命令抽屉",
      keybinding: "Cmd+K",
      when: () => !!host.getActiveSessionId(),
      run: toggleDrawerIgnoreRepeat,
    });
    /* 发送消息:无键位仅暴露(设置清单数据面);发送行为完全归 Composer 既有路径 */
    ctx.registerCommand({
      id: "composer.send",
      title: "发送消息",
      run: () => composerSendRef.current?.(),
    });
    /* 抽屉 plugin 区可执行条目(开右栏面板/开设置)→ 无键位命令;抽屉交互本身不动 */
    for (const cmd of pluginDrawerCommands()) ctx.registerCommand(cmd);
  },
  deactivate() {
    document.removeEventListener("keyup", onDrawerKeyRelease);
    window.removeEventListener("blur", rearmDrawerKey);
  },
};
