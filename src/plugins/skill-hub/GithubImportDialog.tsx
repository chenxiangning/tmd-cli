/**
 * GitHub 链接导入弹窗(2026-10-18)── 输入框 + 下载编排:解析(githubImport)
 * → netDownload 归档 → skillExtract 解压 → 回调父视图走统一发现/展示
 * (loadPicked)。成功后根目录登记权交父视图(tempDirs,卸载清理);失败
 * 自清半成品并在弹窗内报错。骨架 = kernel DialogShell 同形制。
 */
import { useEffect, useRef, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { DownloadSimple } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { importGithubArchive } from "./githubImport";

export function GithubImportDialog({
  onClose,
  onLoaded,
}: {
  onClose: () => void;
  /** 成功回调:dir 进发现层,label 作展示名,root 交父视图登记清理。 */
  onLoaded: (res: { dir: string; label: string; root: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 挂载即聚焦输入框(编程聚焦替代 autoFocus 字面量,react-doctor/no-autofocus) */
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const go = async (): Promise<void> => {
    const link = url.trim();
    if (!link || busy) return;
    setBusy(true);
    setError(null);
    try {
      onLoaded(await importGithubArchive(link));
    } catch (e) {
      setError(`${t("GitHub 下载失败")}:${errTextDisplay(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title={t("从 GitHub 导入")}
      icon={<DownloadSimple className="size-4" aria-hidden />}
      width={520}
      locked={busy}
      onClose={onClose}
      footer={
        <DialogActions
          className="mt-4"
          submitting={busy}
          confirmDisabled={!url.trim()}
          confirmLabel={t("下载并发现")}
          onConfirm={() => void go()}
          onCancel={onClose}
        />
      }
    >
      <div className="mt-3 flex flex-col gap-1 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-muted)">{t("GitHub 仓库链接")}</span>
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) void go();
            }}
            placeholder="https://github.com/owner/repo"
            className="rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1.5 text-xs outline-none focus:border-(--tmd-accent)"
            data-gh-url-input
          />
        </label>
        <span className="text-meta text-(--tmd-fg-faint)">
          {t("支持仓库页、/tree 分支页、.git、git@ 或 owner/repo;技能目录自动发现,仓库内层级不限")}
        </span>
        {error && (
          <span className="text-(--tmd-err)" role="alert" data-gh-import-error>
            {error}
          </span>
        )}
      </div>
    </DialogShell>
  );
}
