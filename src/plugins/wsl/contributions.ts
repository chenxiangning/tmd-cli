/**
 * WSL 来源贡献 —— 经 kernel 三注册表向宿主提供的全部能力:
 * - workspaceOrigins:侧栏过滤 chip / 工作区徽章 / 新建会话 SSH 适配(探针过滤)
 *   / 添加工作区弹层 tab;
 * - fileSources:远程文件树浏览与 wslr:// 文本读取(files 插件按协议消费);
 * - ptyAdapters:UNC 工作区的 spawn 包装与内置终端直落发行版(本文件返回)。
 * 禁用 wsl 插件(重启生效)后注册表为空,宿主回到无来源形态。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import type { Workspace } from "@kernel/workspace";
import type { DirEntry } from "@kernel/ipc";
import type { WorkspaceOrigin } from "@kernel/workspaceOrigins";
import type { RemoteFileSource } from "@kernel/fileSources";
import { getSettingsState } from "@kernel/settings";
import {
  getWslProbedBins,
  isRemoteWslFile,
  parseRemoteWslFile,
  REMOTE_WSL_FILE_MAX_BYTES,
  remoteWslFileUri,
  wslRemoteSpawnCommand,
  type RemoteWslFileRef,
} from "./wslCore";

function joinPath(base: string, name: string): string {
  if (base === "~") return `~/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

/** 工作区绑定的 SSH 主机配置(本机 wsl 形态 hostId=null → null)。 */
function sshHostOf(ws: Workspace) {
  const hostId = ws.wsl?.hostId;
  if (!hostId) return null;
  return getSettingsState().settings.ssh.hosts.find((h) => h.id === hostId) ?? null;
}

/** 新建会话菜单提示行:未探测 / 探测后全空各给一句引导(与 DistroPanel 探针闭环)。 */
function menuNote(ws: Workspace): string | null {
  const wsl = ws.wsl;
  if (!wsl) return null;
  const probed = getWslProbedBins(wsl.distro);
  if (probed === null) {
    return t("未探测 {distro} 引擎;展开 WSL 卡检测发行版后可新建会话", { distro: wsl.distro });
  }
  return probed.length === 0 ? t("{distro} 内未检出任何引擎", { distro: wsl.distro }) : null;
}

/** 工作区来源:侧栏过滤 / 徽章 / 新建会话适配 / 添加弹层 tab。 */
export function buildWslWorkspaceOrigin(addTab: WorkspaceOrigin["addTab"]): WorkspaceOrigin {
  return {
    id: "wsl",
    label: "WSL",
    matches: (ws) => !!ws.wsl || ws.root.startsWith("\\\\wsl.localhost\\"),
    localDiskHistory: false,
    badge: (ws) =>
      ws.wsl
        ? { text: "WSL", title: `${ws.wsl.distro}${ws.wsl.hostId ? " · SSH" : ""}` }
        : { text: "WSL", title: ws.root },
    spawnCliSession: (ws, profile) => {
      const wsl = ws.wsl;
      const sshHost = sshHostOf(ws);
      if (!wsl || !sshHost) return false;
      /* spawn 被拒的原因由内核广播 sessionStartFailed(toast),此处吞掉 rejection。 */
      void host
        .createSshSession(
          sshHost,
          ws.id,
          wslRemoteSpawnCommand(wsl.distro, { cd: ws.root, engine: profile.command }),
          profile.id,
        )
        .catch(() => undefined);
      return true;
    },
    filterCliProfiles: (ws, profiles) => {
      if (!ws.wsl) return profiles;
      const probed = getWslProbedBins(ws.wsl.distro);
      /* 未探测 = 发行版内哪些引擎可用未知,本机已知引擎清单对远端是噪音
         (验收裁决:未检出可用服务时不显示不可用的 CLI)→ 空列表 + 引导 note。 */
      if (!probed) return [];
      const probedSet = new Set(probed);
      return profiles.filter((p) => probedSet.has(p.command));
    },
    sessionMenuNote: menuNote,
    addTab,
    remoteExec: (ws) => {
      const wsl = ws.wsl;
      const cfg = sshHostOf(ws);
      if (!wsl || !cfg) return null;
      return (script) => ipc.wslExec(wsl.distro, script, cfg);
    },
    openRemoteDiskSession: (ws, profile, cliSessionId) => {
      const wsl = ws.wsl;
      const cfg = sshHostOf(ws);
      if (!wsl || !cfg || !profile.resumeArgs) return false;
      const resume = profile.resumeArgs(cliSessionId);
      if (resume.length === 0) return false;
      void host
        .createSshSession(
          cfg,
          ws.id,
          wslRemoteSpawnCommand(wsl.distro, {
            cd: ws.root,
            engine: [profile.command, ...resume].join(" "),
          }),
          profile.id,
          /* 已知身份随会话透传:去重聚焦既有会话 + 显式绑定(标题回填/磁盘行
             去重/远程状态读取都靠它;远程兜底的 createdAt 匹配够不着 resume 旧文件)。 */
          cliSessionId,
        )
        .catch(() => undefined);
      return true;
    },
    newSessionLabel: () => t("新建 WSL 会话"),
  };
}

/** 远程文件源:浏览(listDir)与 wslr:// 文本读取,数据走 wsl_* IPC 通道。 */
export function buildWslFileSource(): RemoteFileSource {
  return {
    id: "wslr",
    appliesTo: (ws) => !!ws.wsl?.hostId && !!sshHostOf(ws),
    label: (ws) => {
      const wsl = ws.wsl!;
      const cfg = sshHostOf(ws);
      return `${wsl.distro} · ${cfg ? cfg.name || `${cfg.username}@${cfg.host}` : "?"}`;
    },
    listDir: async (ws, path): Promise<DirEntry[]> => {
      const wsl = ws.wsl!;
      const cfg = sshHostOf(ws);
      if (!cfg) throw new Error(t("远程主机配置已删除,无法浏览文件;请重新选择远程宿主。"));
      const rows = await ipc.wslListDir(wsl.distro, path, cfg);
      return rows.map((e) => ({ name: e.name, path: joinPath(path, e.name), isDir: e.isDir }));
    },
    fileUri: (ws, path) => remoteWslFileUri(sshHostOf(ws)!.id, ws.wsl!.distro, path),
    ownsUri: (path) => isRemoteWslFile(path),
    readText: async (uri: string, maxBytes: number) => {
      const ref: RemoteWslFileRef | null = parseRemoteWslFile(uri);
      const cfg = ref
        ? getSettingsState().settings.ssh.hosts.find((h) => h.id === ref.hostId) ?? null
        : null;
      if (!ref || !cfg) throw new Error(t("远程主机配置已删除,无法读取文件"));
      const r = await ipc.wslReadFileText(ref.distro, ref.linuxPath, Math.min(maxBytes, REMOTE_WSL_FILE_MAX_BYTES), cfg);
      if (r.truncated || r.content === null) {
        throw new Error(t("远程文件超过 512KB,暂不支持预览(M1)"));
      }
      return r.content;
    },
  };
}
