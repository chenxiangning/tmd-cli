/**
 * WSL 插件注册面 —— 全部能力经三注册表 + welcome.footer 贡献:
 * - WslCard(welcome.footer):本机/远程发行版面板(实现见 WslCard.tsx);
 * - workspaceOrigins:侧栏过滤/徽章/新建会话 SSH 适配/添加弹层 tab;
 * - fileSources:远程文件树浏览与 wslr:// 文本读取;
 * - ptyAdapters:UNC 工作区的 spawn 包装与内置终端直落发行版。
 * 拔掉本插件(重启生效)后注册表为空,宿主回内建形态(边界语义见 tasks §12)。
 */

import { DesktopIcon } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import {
  registerRemoteFileSource,
  type RemoteFileSource,
} from "@kernel/fileSources";
import { registerWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { registerShellSpecProvider, registerSpecWrapper } from "@kernel/ptyAdapters";
import { buildWslFileSource, buildWslWorkspaceOrigin } from "./contributions";
import { AddWslTab } from "./AddWslTab";
import { WslCard } from "./WslCard";
import { isWslWorkspace, parseWslUnc, wslShellSpec, wrapWslSpec } from "./wslCore";

export const wslPlugin: Plugin = {
  id: "wsl",
  meta: {
    name: "WSL 主机",
    abbr: "WSL",
    desc: "WSL 发行版面板:本机/远程连接,发行版探测、添加工作区、远程打开引擎会话",
    icon: DesktopIcon,
    iconColor: "#0A7C4B",
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("welcome.footer", { order: 10, component: WslCard });
    /* 向宿主注册表贡献来源能力(全部可退订)。 */
    const offSource = registerRemoteFileSource(buildWslFileSource() as RemoteFileSource);
    const offOrigin = registerWorkspaceOrigin(
      buildWslWorkspaceOrigin({ label: "WSL 发行版", component: AddWslTab }),
    );
    const offWrap = registerSpecWrapper(wrapWslSpec);
    const offShell = registerShellSpecProvider({
      appliesTo: isWslWorkspace,
      build: async (ws) => {
        const unc = parseWslUnc(ws.root);
        if (!unc) throw new Error(t("工作区 root 不是 WSL UNC 路径"));
        return wslShellSpec(unc.distro, unc.linuxPath, "wsl-bash");
      },
    });
    return () => {
      offSource();
      offOrigin();
      offWrap();
      offShell();
    };
  },
};
