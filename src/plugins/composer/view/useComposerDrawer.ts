/**
 * Composer 命令抽屉 hook —— 自 Composer.tsx 拆出(文件规模铁则)。
 *
 * 数据:profile 四分区解析 + 内核插件注册表;两阶段渲染(先静态零 IO,
 * 动态发现到达后整体替换)。执行三模式(send/insert/open)回调交回组件。
 */

import { useEffect, useState } from "react";
import type { CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { openSettingsPanel } from "@kernel/settings";
import { setFilePanelMode } from "@kernel/filePanel";
import { prepareSendPayload } from "../serialize/serialize";
import { insertAtCursor } from "./useComposerAttachments";
import { useDrawerOpen } from "../state/drawerOpen";
import {
  resolveProfileDrawerItems,
  resolvePluginDrawerItems,
  staticProfileDrawerItems,
  type DrawerItem,
} from "../drawerItems";

/** 抽屉条目 → 实际写入幕布的文本(token 覆盖默认;发送前统一走 prepareSendPayload)。 */
function drawerWireText(item: DrawerItem): string {
  if (item.token) return item.token.trim();
  return item.section === "skill" ? `$${item.name}` : `/${item.name}`;
}

export function useComposerDrawer({
  profile,
  cwd,
  textareaRef,
  value,
  setValue,
  setCursor,
}: {
  profile: CliProfile | null;
  cwd: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
}) {
  /* ── 命令抽屉(openspec/changes/composer-command-drawer)── */
  const drawerOpen = useDrawerOpen();
  const [drawerItems, setDrawerItems] = useState<DrawerItem[]>([]);
  useEffect(() => {
    if (!drawerOpen) return;
    if (!profile) {
      /* 会话消失(profile → null)时清掉上一个 CLI 的残留条目,只留插件区 */
      setDrawerItems(resolvePluginDrawerItems());
      return;
    }
    /* 两阶段渲染:先静态(零 IO,omp/pi RPC 冷启动 5-6s 期间抽屉不空白),
       动态发现到达后整体替换(profile → null 分支同款只留插件区) */
    setDrawerItems([...staticProfileDrawerItems(profile), ...resolvePluginDrawerItems()]);
    let cancelled = false;
    void resolveProfileDrawerItems(profile, cwd).then((items) => {
      if (!cancelled) setDrawerItems([...items, ...resolvePluginDrawerItems()]);
    });
    return () => { cancelled = true; };
  }, [drawerOpen, profile, cwd]);

  /* send 与手动发送完全同路径(prepareSendPayload → host.writeSession,translate 生效,零拦截;
     writeSession 同时锚定对话(呼吸灯首写闸) —— 用户首写后的输出才按对话语义结算呼吸灯);
     返回写入的 wire 文本(translate 后)供抽屉 toast 展示;无会话/无 profile 返回空串
     (spec:静默守卫,不弹"已发送"假反馈) */
  function sendFromDrawer(item: DrawerItem): string {
    const sid = host.getActiveSessionId();
    if (!sid || !profile) return "";
    const text = drawerWireText(item);
    const wire = prepareSendPayload(profile, text);
    host.writeSession(sid, wire);
    host.events.emit(KernelTopics.promptSent, { sessionId: sid, text: text.slice(0, 400) });
    return wire.replace(/\r$/, "");
  }

  function insertFromDrawer(item: DrawerItem): void {
    const token = item.token ?? (item.section === "skill" ? `$${item.name} ` : `/${item.name} `);
    if (textareaRef.current) insertAtCursor(textareaRef.current, value, setValue, setCursor, token);
  }

  function openFromDrawer(item: DrawerItem): void {
    if (item.panelId) setFilePanelMode(item.panelId);
    else openSettingsPanel();
  }

  return { drawerOpen, drawerItems, sendFromDrawer, insertFromDrawer, openFromDrawer };
}
