/**
 * WSL 主机卡 —— welcome 页尾(welcome.footer 挂点)的发行版面板。
 *
 * 两段共存(2026-09-12 验收裁决:「本机|远程」段控无意义,拔掉):
 * - 本机段(仅本机 WSL 可用时渲染,即 Windows):发行版枚举、设默认、
 *   添加 WSL 工作区(UNC 路径进 workspace 表);
 * - 远程段:经 SSH 连 Windows 宿主(复用 settings.ssh.hosts + 手动添加表单),
 *   发行版行展开 DistroPanel(引擎探针/目录浏览/打开会话)。
 * 卡常驻渲染(mac 也可见远程入口);两侧数据互不影响。
 * 自 index.tsx 拆出(文件规模铁则 + only-export-components:插件注册面归 index)。
 */

import { useCallback, useEffect, useState } from "react";
import { CaretDownIcon, CaretRightIcon, DesktopIcon, FolderSimplePlusIcon } from "@phosphor-icons/react";
import { ipc, type WslDistro, type WslInfo } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { WslRemoteSection } from "./RemoteSection";
import { AddWslWorkspaceDialog } from "./WorkspaceDialog";

/** 卡头状态行(本机检测态 / 本机不可用时的远程提示)。 */
function CardStatus({
  loading,
  info,
  shown,
  running,
  pinnedDistro,
}: {
  loading: boolean;
  info: WslInfo | null;
  shown: WslDistro[];
  running: number;
  pinnedDistro: string;
}) {
  if (!info) return <>{t("经 SSH 连接远程宿主")}</>;
  if (loading) return <>{t("检测中…")}</>;
  return (
    <>
      {t("已连接")} · {info?.wslVersion ?? "wsl"} · {shown.length} {t("个发行版")}
      {running > 0 && <span className="wsl-ok"> · {running} {t("运行中")}</span>}
      {pinnedDistro && <span className="wsl-def"> · {pinnedDistro}</span>}
    </>
  );
}

/** 本机段:发行版行(设默认)+ 显示全部 + 事实行 + 动作。 */
function LocalSection({
  info,
  loading,
  shown,
  hiddenCount,
  pinnedDistro,
  onRefresh,
  onSetDefault,
  onAdd,
  onShowAll,
}: {
  info: WslInfo | null;
  loading: boolean;
  shown: WslDistro[];
  hiddenCount: number;
  pinnedDistro: string;
  onRefresh: () => void;
  onSetDefault: (name: string) => void;
  onAdd: () => void;
  onShowAll: () => void;
}) {
  const defaultName = pinnedDistro || (info?.distros.find((x) => x.default) ?? info?.distros[0])?.name;
  return (
    <>
      {shown.map((d) => (
        <div className="wsl-distro-row" key={d.name}>
          <span className={`wsl-dot ${d.running ? "ok" : ""}`} aria-hidden />
          <span className="wsl-distro-name">{d.name}</span>
          <span className="wsl-distro-ver">WSL {d.version}</span>
          <span className="wsl-distro-state">{d.running ? t("运行中") : t("已停止")}</span>
          <button
            type="button"
            className="wsl-btn ghost"
            disabled={d.name === defaultName}
            onClick={() => onSetDefault(d.name)}
          >
            {t("设默认")}
          </button>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="wsl-btn ghost wsl-showall"
          onClick={onShowAll}
        >
          {t("显示全部发行版")}({hiddenCount})
        </button>
      )}
      {info?.linuxUser && (
        <div className="wsl-facts">
          {t("默认发行版用户")}:{info.linuxUser} · $HOME:{info.linuxHome ?? "—"}
        </div>
      )}
      <div className="wsl-card-actions">
        <button type="button" className="wsl-btn" onClick={onRefresh} disabled={loading}>
          {t("重新检测")}
        </button>
        <button type="button" className="wsl-btn primary" onClick={onAdd} disabled={!info?.distros.length}>
          <FolderSimplePlusIcon size="0.75rem" aria-hidden /> {t("添加 WSL 工作区")}
        </button>
      </div>
      <div className="wsl-hint">
        {t("WSL 工作区以 \\\\wsl.localhost 路径登记;引擎会话在该目录内以 wsl.exe 包装启动(幕布/工作区行为与本地一致)。")}
      </div>
    </>
  );
}

export function WslCard() {
  const [info, setInfo] = useState<WslInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const { settings } = useSettingsState();
  const pinnedDistro = settings.wsl.defaultDistro;

  const refresh = useCallback(() => {
    setLoading(true);
    void (async () => {
      let r: WslInfo | null = null;
      try {
        r = await ipc.wslInfo();
      } catch {
        /* 纯浏览器 dev 无 Tauri runtime:同步抛/拒绝都落这里 */
      }
      setInfo(r && r.available ? r : null);
    })().finally(() => setLoading(false));
  }, []);
  useEffect(refresh, [refresh]);

  const shown = pinnedDistro
    ? (info?.distros ?? []).filter((d) => d.name === pinnedDistro)
    : (info?.distros ?? []);
  const hiddenCount = (info?.distros.length ?? 0) - shown.length;
  const running = shown.filter((d) => d.running).length;

  const setDefault = async (name: string) => {
    try {
      const r = await ipc.procCommunicate({
        command: "wsl.exe",
        /* wsl.exe 只认 --set-default(/setdefault 是 wslconfig 的语法);
           失败非零退出码必须查,不能静默写 settings。 */
        args: ["--set-default", name],
        cwd: await ipc.configHomeDir(),
        closeStdin: true,
        timeoutMs: 10_000,
      });
      if (r.timedOut || (r.code !== null && r.code !== 0)) {
        console.warn("wsl: 设默认发行版失败(code=%s):%s", r.code, r.stderr);
        return;
      }
      updateSettings({ wsl: { ...settings.wsl, defaultDistro: name } });
      refresh();
    } catch (e) {
      console.warn("wsl: 设默认发行版失败", e);
    }
  };

  return (
    <section className="wsl-card">
      <button
        type="button"
        className="wsl-card-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <CaretDownIcon size="0.75rem" aria-hidden /> : <CaretRightIcon size="0.75rem" aria-hidden />}
        <DesktopIcon size="0.875rem" aria-hidden />
        <b>WSL</b>
        <span className="wsl-card-status">
          <CardStatus
            loading={loading}
            info={info}
            shown={shown}
            running={running}
            pinnedDistro={pinnedDistro}
          />
        </span>
      </button>
      {expanded && (
        <div className="wsl-card-body">
          {info && (
            <LocalSection
              info={info}
              loading={loading}
              shown={shown}
              hiddenCount={hiddenCount}
              pinnedDistro={pinnedDistro}
              onRefresh={refresh}
              onSetDefault={(name) => void setDefault(name)}
              onAdd={() => setAdding(true)}
              onShowAll={() => updateSettings({ wsl: { ...settings.wsl, defaultDistro: "" } })}
            />
          )}
          <WslRemoteSection />
        </div>
      )}
      {adding && info && <AddWslWorkspaceDialog distros={info.distros} onClose={() => setAdding(false)} />}
    </section>
  );
}
