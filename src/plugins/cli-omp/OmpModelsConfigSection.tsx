/**
 * omp 自定义供应商段 —— ~/.omp/agent/models.yml 摘要行 + 「编辑配置」原文编辑器。
 * 保存 = 全文覆盖(.bak-tmd 备份壳);不做 YAML 语义校验(omp 启动自检,原文可回改)。
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { GitDialogShell, DialogActions } from "@plugins/git/views/remoteDialogs/GitDialogShell";
import { BrandAvatar, StatusDot } from "./OmpOauthSection";
import {
  MODELS_TEMPLATE,
  readOmpModelsConfig,
  saveOmpModelsConfig,
  type OmpModelsConfig,
} from "./modelsConfig";
import { OmpCustomProviderDialog } from "./OmpCustomProviderDialog";

export function OmpModelsConfigSection() {
  const [cfg, setCfg] = useState<OmpModelsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(
    () =>
      readOmpModelsConfig()
        .then(setCfg)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(
    async (raw: string) => {
      setSaving(true);
      setError(null);
      try {
        await saveOmpModelsConfig(raw);
        await refresh();
        setEditing(false);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  return (
    <section className="provider-panel mt-6" data-testid="omp-models-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h4 className="shrink-0 text-xs font-semibold text-(--tmd-fg)">{t("自定义供应商")}</h4>
          <span className="truncate text-[0.6875rem] text-(--tmd-fg-muted)">
            {t("写入 ~/.omp/agent/models.yml · 中转站 / 自定义模型")}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="cli-cfg-btn shrink-0"
            onClick={() => setAdding(true)}
            data-testid="omp-models-add"
          >
            {t("添加供应商")}
          </button>
          <button
            type="button"
            className="cli-cfg-btn shrink-0"
            onClick={() => setEditing(true)}
            data-testid="omp-models-edit"
          >
            {t("编辑配置")}
          </button>
        </div>
      </div>

      {error && (
        <div className="cli-cfg-error mt-3" role="alert" data-testid="omp-models-error">
          <p>{error}</p>
          <button type="button" className="cli-cfg-link" onClick={() => setError(null)}>
            {t("关闭")}
          </button>
        </div>
      )}

      <ul
        className="mt-2 divide-y divide-(--tmd-border) overflow-hidden rounded-lg border border-(--tmd-border) bg-(--tmd-bg-card)"
        data-testid="omp-models-list"
      >
        {(cfg?.providers ?? []).map((p) => (
          <li key={p.name} className="flex min-h-[3.25rem] items-center gap-3 px-3 py-2.5">
            <BrandAvatar id={p.name} name={p.name} />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-xs text-(--tmd-fg)">{p.name}</p>
              <p className="truncate font-mono text-[0.6875rem] text-(--tmd-fg-muted)">{p.baseUrl}</p>
            </div>
            {p.api && (
              <code className="shrink-0 rounded bg-(--tmd-bg-popover) px-1.5 py-0.5 font-mono text-[0.6875rem] text-(--tmd-fg-muted)">
                {p.api}
              </code>
            )}
            <span className="shrink-0 text-[0.6875rem] text-(--tmd-fg-muted)">
              {t("{n} 个模型", { n: p.modelCount })}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-(--tmd-fg-muted)">
              <StatusDot on={p.hasKey} />
              {p.hasKey ? t("含 Key") : t("无 Key")}
            </span>
          </li>
        ))}
        {cfg && cfg.providers.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-(--tmd-fg-muted)">
            {t("还没有自定义供应商,点右上角「编辑配置」添加")}
          </li>
        )}
      </ul>
      {cfg && (
        <p className="mt-1.5 truncate font-mono text-[0.6875rem] text-(--tmd-fg-muted)">{cfg.path}</p>
      )}

      {adding && (
        <OmpCustomProviderDialog onClose={() => setAdding(false)} onSaved={() => void refresh()} />
      )}

      {editing && (
        <ModelsEditorDialog
          initial={cfg?.exists ? cfg.raw : MODELS_TEMPLATE}
          saving={saving}
          onClose={() => setEditing(false)}
          onSubmit={(raw) => void handleSave(raw)}
        />
      )}
    </section>
  );
}

function ModelsEditorDialog({
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  initial: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (raw: string) => void;
}) {
  const [raw, setRaw] = useState(initial);
  return (
    <GitDialogShell
      title={t("编辑 models.yml")}
      icon={null}
      width={760}
      locked={saving}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("保存")}
          confirmDisabled={raw === initial}
          submitting={saving}
          onConfirm={() => onSubmit(raw)}
          onCancel={onClose}
        />
      }
    >
      <textarea
        aria-label={t("models.yml 原文")}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        spellCheck={false}
        rows={22}
        className="mt-3 w-full resize-y rounded border border-(--tmd-border) bg-(--tmd-bg) p-2 font-mono text-xs"
        data-testid="omp-models-editor"
      />
    </GitDialogShell>
  );
}
