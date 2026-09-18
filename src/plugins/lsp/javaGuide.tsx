/**
 * Java 语言服务引导卡片 —— 首个 .java 语义动作发现未安装时弹出
 *(discover 返回 null 的 UI 侧出口);JDK≥17 预检 + 一键下载安装。
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { installJdt } from "./javaInstall";
import { closeJavaGuide, useJavaGuideVisible } from "./javaGuideStore";
import { javaMajorVersion } from "./discovery";

export function JavaGuideOverlay() {
  const visible = useJavaGuideVisible();
  const [jdk, setJdk] = useState<number | null | "checking">("checking");
  const jdkMajor = jdk === "checking" ? null : jdk;
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || jdk !== "checking") return;
    void javaMajorVersion().then((v) => setJdk(v));
  }, [visible, jdk]);

  const close = useCallback(() => closeJavaGuide(), []);

  const install = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await installJdt(setStatus);
      setStatus(null);
      closeJavaGuide();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!visible) return null;
  return (
    <>
      <div className="wsmenu-backdrop" role="presentation" onClick={close} />
      <div className="lsp-guide" onKeyDown={(e) => e.key === "Escape" && close()}>
        <div className="lsp-guide-title">{t("Java 语言服务未安装")}</div>
        <div className="lsp-guide-body">
          {t("语义跳转/引用需要 eclipse.jdt.ls(约 100MB,装到 ~/.tmd-cli/lsp/jdt)。")}
          <div className={jdkMajor !== null && jdkMajor < 17 ? "lsp-guide-warn" : "lsp-guide-ok"}>
            {jdk === "checking"
              ? t("检测 JDK…")
              : jdkMajor === null
                ? t("未检测到 java(需要 JDK 17+,请先安装)")
                : jdkMajor < 17
                  ? t("JDK 版本过低(需要 17+,当前 {v})", { v: String(jdkMajor) })
                  : t("已检测 JDK {v}", { v: String(jdkMajor) })}
          </div>
          {status && <div className="lsp-guide-status">{status}</div>}
          {error && <div className="lsp-guide-warn">{error}</div>}
        </div>
        <div className="lsp-guide-actions">
          <button type="button" className="lsp-guide-btn" disabled={busy} onClick={close}>
            {t("暂不安装")}
          </button>
          <button type="button" className="lsp-guide-btn lsp-guide-primary" disabled={busy} onClick={() => void install()}>
            {busy ? t("安装中…") : t("下载并安装")}
          </button>
        </div>
      </div>
    </>
  );
}
