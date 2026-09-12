/**
 * 添加 WSL 工作区弹层(本机模式)—— 发行版下拉 + Linux 目录浏览(懒加载)+
 * 路径输入。目录列表经 wsl_list_dir(本机 wsl.exe,仅 Windows;mac 上按钮报
 * 「仅 Windows」如实降级)。UNC 预览即工作区 root。
 */

import { useState } from "react";
import type { WslDistro, WslDirEntry } from "@kernel/ipc";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { wslToUnc } from "./wslCore";
import { addWorkspace } from "@kernel/workspace";

function joinPath(base: string, name: string): string {
  if (base === "~") return `~/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function parentOf(p: string): string {
  if (p === "~" || p === "/") return p;
  const up = p.replace(/\/[^/]+$/, "");
  return up === "" ? "/" : up;
}

/** 目录浏览小面板:懒加载逐级进入,选中 = 回填路径输入。 */
function DirBrowser({ distro, onPick }: { distro: string; onPick: (path: string) => void }) {
  const [dir, setDir] = useState("~");
  const [entries, setEntries] = useState<WslDirEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (path: string) => {
    setErr(null);
    void ipc
      .wslListDir(distro, path)
      .then((r) => {
        setDir(path);
        setEntries(r);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="wsl-dir-browser">
      <div className="wsl-dir-crumb">
        <button type="button" className="wsl-btn ghost" onClick={() => load(dir === "~" ? "~" : parentOf(dir))}>
          {t("上一级")}
        </button>
        <code title={dir}>{dir}</code>
        <button type="button" className="wsl-btn ghost" onClick={() => onPick(dir)} disabled={dir === "~"}>
          {t("选这一层")}
        </button>
      </div>
      {err && <div className="wsl-remote-err">{err}</div>}
      {entries === null && !err && (
        <button type="button" className="wsl-btn" onClick={() => load("~")}>
          {t("浏览目录")}
        </button>
      )}
      {entries !== null && (
        <div className="wsl-dir-list">
          {entries.map((e) =>
            e.isDir ? (
              <button key={e.name} type="button" className="wsl-dir-row" onClick={() => load(joinPath(dir, e.name))}>
                {e.name}/
              </button>
            ) : (
              <span key={e.name} className="wsl-dir-row off">
                {e.name}
              </span>
            ),
          )}
          {entries.length === 0 && <span className="wsl-hint">{t("(空目录)")}</span>}
        </div>
      )}
    </div>
  );
}

export function AddWslWorkspaceDialog({ distros, onClose }: { distros: WslDistro[]; onClose: () => void }) {
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
      <dialog open className="wsl-dialog m-0" aria-label={t("添加 WSL 工作区")} onClick={(e) => e.stopPropagation()}>
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
                {d.name}({d.running ? t("运行中") : t("已停止")})
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
        {distro && <DirBrowser distro={distro} onPick={(p) => setPath(p === "~" ? "" : p)} />}
        {valid && distro && (
          <div className="wsl-unc-preview" title={wslToUnc(distro, posix)}>
            {t("工作区根(UNC)")}:{wslToUnc(distro, posix)}
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
      </dialog>
    </div>
  );
}
