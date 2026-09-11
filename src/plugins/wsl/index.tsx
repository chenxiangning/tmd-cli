/**
 * WSL 主机卡 —— welcome 页尾(welcome.footer 挂点)的发行版面板。
 *
 * P1 范围(原型 docs/prototypes/wsl-1-connect.html 的连接/发行版段):
 * 发行版枚举(wsl_info)、设默认(wslconfig /setdefault)、添加 WSL 工作区
 * (UNC 路径进 workspace 表;spawn 包装由 kernel/wsl.ts 在会话创建时透明完成)。
 * 引擎探针子表与 UNC 会话扫描属 P2。非 Windows / wsl.exe 缺失 = 整卡不渲染。
 */

import { useCallback, useEffect, useState } from "react";
import { CaretDown, CaretRight, Desktop, FolderSimplePlus } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { ipc, type WslDistro, type WslInfo } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { wslToUnc } from "@kernel/wsl";
import { addWorkspace } from "@kernel/workspace";
import { updateSettings, useSettingsState } from "@kernel/settings";

/** 添加 WSL 工作区弹层:发行版下拉 + Linux 目录输入(绝对路径,~ 展开交给显示层)。 */
function AddWslWorkspaceDialog({
  distros,
  onClose,
}: {
  distros: WslDistro[];
  onClose: () => void;
}) {
  const def = distros.find((d) => d.default) ?? distros[0];
  const [distro, setDistro] = useState(def?.name ?? "");
  const [path, setPath] = useState("/home/");
  const [err, setErr] = useState<string | null>(null);
  const posix = path.trim();
  const valid = /^\/[^/]/.test(posix) && posix !== "/";

  const submit = () => {
    if (!distro || !valid) {
      setErr(t("需选择发行版并填写 Linux 绝对路径(如 /home/chen/work/proj)"));
      return;
    }
    const unc = wslToUnc(distro, posix);
    addWorkspace(unc);
    /* 新工作区落盘后刷新会话扫描由 useCliSessionGroup 的 workspace 变化自动驱动 */
    onClose();
  };

  return (
    <div className="wsl-backdrop" role="presentation" onClick={onClose}>
      <div
        className="wsl-dialog"
        role="dialog"
        aria-label={t("添加 WSL 工作区")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wsl-dialog-head">
          <span>{t("添加 WSL 工作区")}</span>
          <button type="button" className="wsl-dialog-x" onClick={onClose} aria-label={t("关闭")}>
            ×
          </button>
        </div>
        <label className="wsl-field">
          <span>{t("发行版")}</span>
          <select value={distro} onChange={(e) => setDistro(e.target.value)}>
            {distros.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}({d.state === "Running" ? t("运行中") : t("已停止")})
              </option>
            ))}
          </select>
        </label>
        <label className="wsl-field">
          <span>{t("Linux 目录")}</span>
          <input
            id="wsl-workspace-path"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              setErr(null);
            }}
            placeholder="/home/chen/work/proj"
            spellCheck={false}
          />
        </label>
        {valid && distro && (
          <div className="wsl-unc-preview" title={uncPreview(distro, posix)}>
            {t("工作区根(UNC)")}:{uncPreview(distro, posix)}
          </div>
        )}
        {err && <div className="wsl-err">{err}</div>}
        <div className="wsl-dialog-foot">
          <button type="button" className="wsl-btn" onClick={onClose}>
            {t("取消")}
          </button>
          <button type="button" className="wsl-btn primary" onClick={submit}>
            {t("添加")}
          </button>
        </div>
      </div>
    </div>
  );
}

function uncPreview(distro: string, posix: string): string {
  return wslToUnc(distro, posix.replace(/\/+$/, ""));
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
    void ipc
      .wslInfo()
      .then((r) => setInfo(r))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(refresh, [refresh]);

  /* 非 Windows / 无 wsl.exe / 无发行版:整卡不渲染(浏览器 dev 桩同样静默)。 */
  if (!loading && (!info || !info.available)) return null;

  const shown = pinnedDistro
    ? (info?.distros ?? []).filter((d) => d.name === pinnedDistro)
    : (info?.distros ?? []);
  const hiddenCount = (info?.distros.length ?? 0) - shown.length;
  const running = shown.filter((d) => d.state.toLowerCase() === "running").length;

  const setDefault = async (name: string) => {
    try {
      await ipc.procCommunicate({
        command: "wsl.exe",
        args: ["/setdefault", name],
        cwd: await ipc.configHomeDir(),
        closeStdin: true,
        timeoutMs: 8000,
      });
      updateSettings({ wsl: { defaultDistro: name } });
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
        {expanded ? <CaretDown size="0.75rem" aria-hidden /> : <CaretRight size="0.75rem" aria-hidden />}
        <Desktop size="0.875rem" aria-hidden />
        <b>WSL</b>
        <span className="wsl-card-status">
          {loading ? (
            t("检测中…")
          ) : (
            <>
              {t("已连接")} · {info?.wslVersion ?? "wsl"} · {shown.length} {t("个发行版")}
              {running > 0 && <span className="wsl-ok"> · {running} {t("运行中")}</span>}
              {pinnedDistro && <span className="wsl-def"> · {pinnedDistro}</span>}
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div className="wsl-card-body">
          {shown.map((d) => (
            <div className="wsl-distro-row" key={d.name}>
              <span
                className={`wsl-dot ${d.state.toLowerCase() === "running" ? "ok" : ""}`}
                aria-hidden
              />
              <span className="wsl-distro-name">{d.name}</span>
              <span className="wsl-distro-ver">WSL {d.version}</span>
              <span className="wsl-distro-state">
                {d.state.toLowerCase() === "running" ? t("运行中") : t("已停止")}
              </span>
              <button
                type="button"
                className="wsl-btn ghost"
                disabled={d.name === (pinnedDistro ?? (info?.distros.find((x) => x.default) ?? info?.distros[0])?.name)}
                onClick={() => void setDefault(d.name)}
              >
                {t("设默认")}
              </button>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button type="button" className="wsl-btn ghost wsl-showall" onClick={() => updateSettings({ wsl: { defaultDistro: "" } })}>
              {t("显示全部发行版")}({hiddenCount})
            </button>
          )}
          {info?.linuxUser && (
            <div className="wsl-facts">
              {t("默认发行版用户")}:{info.linuxUser} · $HOME:{info.linuxHome ?? "—"}
            </div>
          )}
          <div className="wsl-card-actions">
            <button type="button" className="wsl-btn" onClick={refresh} disabled={loading}>
              {t("重新检测")}
            </button>
            <button
              type="button"
              className="wsl-btn primary"
              onClick={() => setAdding(true)}
              disabled={!info?.distros.length}
            >
              <FolderSimplePlus size="0.75rem" aria-hidden /> {t("添加 WSL 工作区")}
            </button>
          </div>
          <div className="wsl-hint">
            {t("WSL 工作区以 \\\\wsl.localhost 路径登记;引擎会话在该目录内以 wsl.exe 包装启动(幕布/工作区行为与本地一致)。")}
          </div>
        </div>
      )}
      {adding && info && (
        <AddWslWorkspaceDialog distros={info.distros} onClose={() => setAdding(false)} />
      )}
    </section>
  );
}

export const wslPlugin: Plugin = {
  id: "wsl",
  meta: {
    name: "WSL 主机",
    abbr: "WSL",
    desc: "WSL 发行版面板:检测/设默认/添加 WSL 工作区(UNC),会话以 wsl.exe 包装启动",
    icon: Desktop,
    iconColor: "#0A7C4B",
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("welcome.footer", { order: 10, component: WslCard });
  },
};
