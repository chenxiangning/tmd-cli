/**
 * ssh 插件 —— SSH 一等会话(russh 引擎)。
 *
 * 注册面:
 * - overlay:SshOverlay(主机选择器 + host key/KBI/密码提示卡);
 * - filePanel:右栏 SSH 面板(连接卡/端口转发/SFTP 树);
 * - sidebarAction:SSH 面板开关入口(左下角设置簇;topbarEntry:false = 顶栏菜单与 tab 条均不进);
 * - editorCenter.tabContent:kind="ssh-file" 远端文件编辑 tab;
 * - 设置 section:主机簿 CRUD + ~/.ssh/config 导入。
 * - shortcuts:ssh.saveRemoteFile(⌘S 保存远端文件,与 files.save 靠 when 互斥)
 *
 * 引擎在 src-tauri/src/ssh/(russh);会话输出走 pty://out 同构事件,
 * 幕布全链路(缓冲/翻页/搜索/tab 条)零分叉。
 */

import { HardDrive } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { ipc, type SessionMeta } from "@kernel/ipc";
import { KernelTopics } from "@kernel/events";
import { host } from "@kernel/host";
import { getFilePanelMode, setFilePanelMode } from "@kernel/filePanel";
import { getActiveTab } from "@kernel/tabs";
import { SshOverlay } from "./SshOverlay";
import { SshPanel } from "./panel/SshPanel";
import { RemoteFileTab, saveRequestRef } from "./editor/RemoteFileTab";
import { SshSettingsSection } from "./settings/SshSettingsSection";
import { refreshForwards, unwatchSshSession, watchSshSession, wireSshEvents } from "./state";
import { MenuEntry } from "./MenuEntry";

/* webview reload 兜底:Rust 侧 SSH 会话跨 reload 存活(事件订阅随 webview 消亡),
   模块加载时重建插件侧镜像:重拉会话表,SSH 会话逐个接线 + 转发对账。 */
void (async () => {
  try {
    const sessions = await ipc.sessionList();
    for (const session of sessions) {
      if (session.kind !== "ssh") continue;
      await watchSshSession(session.id);
      await refreshForwards(session.id);
    }
  } catch {
    /* 纯浏览器 dev(无 Tauri runtime)时静默。 */
  }
})();

export const sshPlugin: Plugin = {
  id: "ssh",
  meta: {
    name: "SSH 远程",
    abbr: "SSH",
    desc: "SSH 终端会话 + SFTP 远端文件 + 本地端口转发",
    icon: HardDrive,
    iconColor: "#8B7CF6",
    category: "feature",
  },
  activate(ctx) {
    /* UI 注册面(四挂载点 + 右栏面板 + 设置分区)。 */
    ctx.contribute("overlay", { order: 30, component: SshOverlay });
    ctx.contribute("workspace.newSessionMenu", { order: 20, component: MenuEntry });
    /* 远端文件编辑 tab:kind="ssh-file" 路由(kernel/tabs 注册表)。 */
    ctx.registerTabContent({ kind: "ssh-file", component: RemoteFileTab });
    /* ⌘S 保存命令:when 限定激活 tab 为远端文件 tab(kind="ssh-file"),否则键穿透;
       与 files.save 同键,靠 when 互斥。触发经模块级 ref 桥转发到挂载中的编辑器。 */
    ctx.registerCommand({
      id: "ssh.saveRemoteFile",
      title: "保存远端文件",
      keybinding: "Cmd+S",
      when: () => getActiveTab()?.kind === "ssh-file",
      run: () => saveRequestRef.current?.(),
    });
    /* 面板开关入口在左下角设置簇(用户裁决 2026-09-06:顶栏「⋯」菜单与 tab 条均不进);
       onSelect 只切面板模式,不回钉顶栏。 */
    ctx.registerFilePanel({
      id: "ssh",
      label: "SSH",
      icon: HardDrive,
      order: 15,
      showFileSubbar: false, // ssh 自带连接/转发/SFTP 摘要段
      topbarEntry: false,
      component: SshPanel,
    });
    ctx.registerSidebarAction({
      id: "ssh-panel",
      label: "SSH",
      icon: HardDrive,
      order: 25,
      active: () => getFilePanelMode() === "ssh",
      onSelect: () => setFilePanelMode("ssh"),
    });
    ctx.registerSettingsSection({
      id: "ssh",
      title: "SSH 远程",
      description: "SSH 主机簿与 known_hosts 信任管理。",
      icon: <HardDrive size="0.875rem" aria-hidden />,
      order: 40,
      tabs: [
        {
          id: "hosts",
          title: "主机",
          icon: <HardDrive size="0.875rem" aria-hidden />,
          order: 0,
          component: SshSettingsSection,
        },
      ],
    });

    /* 事件接线:SFTP 全局通道(async listen 退订经 then 收集)。 */
    const unwires: Array<() => void> = [];
    let sftpActive = true;
    let sftpOff: (() => void) | null = null;
    /* 纯浏览器/Node 测试环境(无 Tauri runtime)listen 直接 reject:吞掉,不产生未处理拒绝。 */
    void wireSshEvents()
      .then((unlisten) => {
        if (!sftpActive) {
          unlisten();
          return;
        }
        sftpOff = unlisten;
      })
      .catch(() => undefined);
    unwires.push(() => {
      sftpActive = false;
      sftpOff?.();
    });

    /* 会话生命周期:SSH 会话出现在会话表即接线状态镜像(状态/提示通道);
       退出(pty://exit)清镜像。 */
    const watchSshSessions = (sessions: SessionMeta[]) => {
      for (const session of sessions) {
        if (session.kind === "ssh") void watchSshSession(session.id);
      }
    };
    watchSshSessions(host.getSessions());
    unwires.push(
      host.events.on<SessionMeta[]>(KernelTopics.sessionsChanged, (sessions) =>
        watchSshSessions(sessions),
      ),
    );
    unwires.push(
      host.events.on<string>(KernelTopics.sessionExited, (sessionId) =>
        unwatchSshSession(sessionId),
      ),
    );

    this.deactivate = () => {
      unwires.forEach((off) => off());
    };
  },
};
