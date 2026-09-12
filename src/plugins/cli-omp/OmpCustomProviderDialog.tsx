/**
 * 「添加供应商」对话框 —— GUI 单独添加 models.yml 自定义供应商。
 * 字段:名称 / API 地址 / 协议(omp 四枚举)/ API Key(可空,建议 $ENV)/ 模型(一行一个)。
 * 保存 = addOmpCustomProvider(读原文 → 校验 → 纯函数插入 → .bak-tmd 备份 → 覆盖写)。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { DialogShell, DialogActions } from "@kernel/DialogShell";
import { SecretInput } from "@kernel/SecretInput";
import { addOmpCustomProvider } from "./modelsConfig";

const API_OPTIONS = [
  { value: "openai-completions", label: "openai-completions" },
  { value: "openai-responses", label: "openai-responses" },
  { value: "anthropic-messages", label: "anthropic-messages" },
  { value: "google-generative-ai", label: "google-generative-ai" },
] as const;

export function OmpCustomProviderDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState<string>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim() && baseUrl.trim() && modelsText.trim();

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await addOmpCustomProvider({
        name,
        baseUrl,
        api,
        apiKey,
        models: modelsText.split("\n"),
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={t("添加供应商")}
      icon={null}
      width={560}
      locked={saving}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("添加")}
          confirmDisabled={!canSubmit}
          submitting={saving}
          onConfirm={() => void submit()}
          onCancel={onClose}
        />
      }
    >
      <div className="mt-3 flex flex-col gap-3">
        {error && (
          <div className="cli-cfg-error" role="alert" data-testid="omp-addprovider-error">
            <p>{error}</p>
            <button type="button" className="cli-cfg-link" onClick={() => setError(null)}>
              {t("关闭")}
            </button>
          </div>
        )}
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[0.6875rem] text-(--tmd-fg-muted)">{t("名称")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-relay"
              className="cli-cfg-input"
              data-testid="omp-addprovider-name"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[0.6875rem] text-(--tmd-fg-muted)">{t("协议")}</span>
            <select value={api} onChange={(e) => setApi(e.target.value)} className="cli-cfg-input">
              {API_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] text-(--tmd-fg-muted)">{t("API 地址")}</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-relay.example.com/v1"
            className="cli-cfg-input"
            data-testid="omp-addprovider-baseurl"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] text-(--tmd-fg-muted)">
            {t("API Key(可空;建议 $ENV_VAR 引用)")}
          </span>
          <SecretInput id="omp-addprovider-key" value={apiKey} onChange={(v) => setApiKey(v)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] text-(--tmd-fg-muted)">
            {t("模型(一行一个 id;高级字段用「编辑配置」)")}
          </span>
          <textarea
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={"grok-4.6\nqwen3.8-max"}
            className="cli-cfg-input resize-y font-mono"
            data-testid="omp-addprovider-models"
          />
        </label>
      </div>
    </DialogShell>
  );
}
