/**
 * ~/.ssh/config 导入弹窗 —— 自 SshSettingsSection.tsx 拆出(文件规模铁则)。
 * 挂载即扫描候选,重复主机禁用勾选;默认勾选全部非重复项。
 */

import { useEffect, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import { getSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { scanSshImportCandidates, type SshImportCandidate } from "../scan";

export function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (candidates: SshImportCandidate[]) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [candidates, setCandidates] = useState<SshImportCandidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void scanSshImportCandidates(getSettingsState().settings.ssh.hosts)
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.candidates);
        setPicked(new Set(result.candidates.filter((c) => !c.duplicate).map((c) => c.name)));
        setState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="ssh-modal-backdrop" onClick={onClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-title">
          <UploadSimple size="0.875rem" aria-hidden />
          <span>{t("从 ~/.ssh/config 导入")}</span>
        </div>
        {state === "loading" ? <div className="ssh-settings-empty">{t("扫描中…")}</div> : null}
        {state === "error" ? <div className="ssh-form-error">{error}</div> : null}
        {state === "ready" ? (
          candidates.length === 0 ? (
            <div className="ssh-settings-empty">{t("~/.ssh/config 里没有可导入的主机段")}</div>
          ) : (
            <div className="ssh-import-list">
              {candidates.map((candidate) => (
                <label className="ssh-import-row" key={`${candidate.name}:${candidate.host}`}>
                  <input
                    type="checkbox"
                    disabled={candidate.duplicate}
                    checked={picked.has(candidate.name)}
                    onChange={() => toggle(candidate.name)}
                  />
                  <span className="ssh-import-name">{candidate.name}</span>
                  <span className="ssh-import-endpoint">
                    {candidate.host}:{candidate.port} · {candidate.username || "—"}
                  </span>
                  <span className="ssh-import-meta">
                    {candidate.duplicate ? t("已存在") : candidate.authType === "privateKey" ? t("私钥") : t("密码")}
                  </span>
                </label>
              ))}
            </div>
          )
        ) : null}
        <div className="ssh-modal-actions">
          <button type="button" onClick={onClose}>
            {t("取消")}
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={state !== "ready"}
            onClick={() => onImport(candidates.filter((c) => picked.has(c.name) && !c.duplicate))}
          >
            {t("导入选中")}
          </button>
        </div>
      </div>
    </div>
  );
}
