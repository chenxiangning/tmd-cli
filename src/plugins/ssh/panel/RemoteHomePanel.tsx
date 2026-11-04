/**
 * RemoteHomePanel —— 右栏「远程」落地页(F-02):SSH 会话现场 / WSL 工作区状态 / 空态引导。
 *
 * 决策见 remoteHome.ts;SSH 会话存在时整页交回 SshPanel(连接卡/端口转发/SFTP
 * 树零重构);WSL 段只读 workspaceOrigins 认领 + wslCore 探针缓存(跨插件纯逻辑
 * import,先例 checkpoints→approval-inbox;wsl 插件禁用后 origin 不认领,
 * 本页自然回落空态,不感知 wsl 私有格式)。
 */

import { DesktopIcon, Plus } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";
import { useWorkspaces } from "@kernel/workspace";
/* wslCore 纯逻辑(探针缓存读侧):ssh→wsl 跨插件 import 先例见文件头注。 */
import { getWslProbedBins } from "@plugins/wsl/wslCore";
import { openHostPicker } from "../state";
import { SshPanel } from "./SshPanel";
import { resolveRemoteHome } from "./remoteHome";

/** 打开 WSL 中央 tab(与 wsl 插件右 rail 动作同 payload;幂等聚焦已有)。 */
function openWslPanel() {
  openTab({ id: "wsl:panel", title: "WSL", path: "", kind: "wsl", payload: null });
}

/** WSL 工作区状态段:发行版 + 本机/SSH 远程 + 探针结论 + 打开面板按钮。 */
function WslHome({ distro, remote }: { distro: string; remote: boolean }) {
  const probed = getWslProbedBins(distro);
  return (
    <div className="ssh-panel" data-icon-decor="wsl">
      <div className="ssh-panel-empty">
        <div className="flex items-center gap-1.5">
          <DesktopIcon size="0.875rem" aria-hidden />
          <span>
            {distro} · {remote ? t("SSH 远程") : t("本机")}
          </span>
        </div>
        <div className="text-(--tmd-fg-faint)">
          {probed === null
            ? t("未探测引擎;打开 WSL 面板点「连接」后可新建会话")
            : probed.length === 0
              ? t("未检出任何引擎")
              : t("已探测 {n} 个引擎", { n: String(probed.length) })}
        </div>
        <button type="button" className="ssh-btn is-primary" onClick={openWslPanel}>
          <DesktopIcon size="0.75rem" aria-hidden /> {t("打开 WSL 面板")}
        </button>
      </div>
    </div>
  );
}

/** 空态:无 SSH 会话且当前工作区非 WSL 来源(纯本地场景不误认)。 */
function RemoteEmpty() {
  return (
    <div className="ssh-panel" data-icon-decor="ssh">
      <div className="ssh-panel-empty">
        <div>{t("还没有远程会话或 WSL 工作区")}</div>
        <button type="button" className="ssh-btn is-primary" onClick={() => openHostPicker()}>
          <Plus size="0.75rem" /> {t("连接主机")}
        </button>
        <p className="text-(--tmd-fg-faint)">
          {t("SSH 连接在新建会话菜单的「远程来源」组;WSL 工作区经「添加工作区 → WSL 发行版」接入。")}
        </p>
      </div>
    </div>
  );
}

/** 右栏「远程」面板本体(ssh/index.tsx activate 时经 registerFilePanel 注册)。 */
export function RemoteHomePanel() {
  useHost();
  const hasSshSessions = host.getSessions().some((s) => s.kind === "ssh");
  const { list, activeId } = useWorkspaces();
  const ws = list.find((w) => w.id === activeId) ?? null;
  const view = resolveRemoteHome(hasSshSessions, ws);
  if (view.kind === "ssh") return <SshPanel />;
  if (view.kind === "wsl") return <WslHome distro={view.distro} remote={view.remote} />;
  return <RemoteEmpty />;
}
