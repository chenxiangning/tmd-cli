/**
 * 添加 WSL 工作区弹层(本机模式)—— 发行版下拉 + Linux 目录浏览(懒加载)+
 * 路径输入。目录列表经 wsl_list_dir(本机 wsl.exe,仅 Windows;mac 上按钮报
 * 「仅 Windows」如实降级)。UNC 预览即工作区 root。
 */

import { useState } from "react";
import type { WslDistro } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { wslToUnc, wslWorkspaceTargetOk } from "./wslCore";
import { addWorkspace } from "@kernel/workspace";
import { WslDirBrowser } from "./WslDirBrowser";

export function AddWslWorkspaceDialog({ distros, onClose }: { distros: WslDistro[]; onClose: () => void }) {
  const def = distros.find((d) => d.default) ?? distros[0];
  const [distro, setDistro] = useState(def?.name ?? "");
  const [path, setPath] = useState("/home/");
  const [err, setErr] = useState<string | null>(null);
  const posix = path.trim();
  const valid = wslWorkspaceTargetOk(posix, false);

  const submit = () => {
    if (!distro || !valid) {
      setErr(t("需选择发行版并填写 Linux 绝对路径(如 /home/chen/work/proj)"));
      return;
    }
    const unc = wslToUnc(distro, posix);
    addWorkspace(unc, { distro, hostId: null });
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
        {distro && <WslDirBrowser distro={distro} start="/" pickLabel={t("选这一层")} onPick={setPath} showFiles="off" />}
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
