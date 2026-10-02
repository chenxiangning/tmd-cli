/**
 * 安装草稿弹窗 —— 模板填空({VAR} 占位 → ConfigInput 表单)+ 目标引擎选择
 * + 落位预览(将写入的 server 形状,密钥值掩码)→ mcpWrite 写回
 * (同 .bak-tmd 纪律,经 hubStore.upsertServer)。
 * Smithery 搜索卡无草稿:打开时拉详情补(installDraft 远程 / manualDraft
 * 本地 stdio 双通道);official/glama 直接用归一结果。
 */
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { DialogShell, DialogActions } from "@kernel/DialogShell";
import { SecretInput } from "@kernel/SecretInput";
import { StyledSelect } from "@kernel/StyledSelect";
import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";
import type { McpEngineState } from "./hubStore";
import { upsertServer } from "./hubStore";
import { inferTransport } from "./entryModel";
import { resolveSmitheryDraft } from "./registrySources";
import { applyDraftValues, slugify, type InstallDraft, type RegistryCard } from "./registryNormalize";

/** 落位预览掩码:secret 型输入落在 env/header 的值显示为固定掩码。 */
function maskForPreview(entry: McpServerEntry, draft: InstallDraft): string {
  const secrets = new Set(draft.configInputs.filter((i) => i.secret).map((i) => i.name));
  const mask = (record: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record && typeof record === "object" ? (record as Record<string, unknown>) : {})) {
      out[k] = typeof v === "string" && secrets.has(k) ? "••••••" : v;
    }
    return out;
  };
  return JSON.stringify({ ...entry, env: mask(entry.env), headers: mask(entry.headers) }, null, 2);
}

function needsSmitheryResolve(card: RegistryCard): boolean {
  return card.source === "smithery" && !card.installDraft && !card.manualDraft;
}

/** Smithery 懒解析 hook:详情拉回后经 applyDetail 回调让宿主同步草稿态(文件规模与复杂度拆出)。 */
function useSmitheryResolve(card: RegistryCard, applyDetail: (detail: RegistryCard) => void) {
  const [resolved, setResolved] = useState<RegistryCard>(card);
  const [resolving, setResolving] = useState(() => needsSmitheryResolve(card));
  const [error, setError] = useState<string | null>(null);
  const applyRef = useRef(applyDetail);
  useEffect(() => {
    applyRef.current = applyDetail;
  });
  useEffect(() => {
    if (!needsSmitheryResolve(card)) return;
    let alive = true;
    void resolveSmitheryDraft(card)
      .then((detail) => {
        if (!alive) return;
        setResolved(detail);
        applyRef.current(detail);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => alive && setResolving(false));
    return () => {
      alive = false;
    };
  }, [card]);
  return { resolved, resolving, error };
}

/** 派生态纯函数(复杂度拆出):目标引擎、当前草稿、必填校验。 */
function deriveModalState(params: {
  engines: McpEngineState[];
  profileId: string;
  resolved: RegistryCard;
  draftKind: "install" | "manual";
  name: string;
  values: Record<string, string>;
}) {
  const { engines, profileId, resolved, draftKind, name, values } = params;
  const engine = engines.find((e) => e.profileId === profileId) ?? null;
  const draft = draftKind === "install" ? resolved.installDraft : resolved.manualDraft;
  const idTaken = engine ? Object.keys(engine.entries ?? {}).includes(name.trim()) : false;
  const missingRequired =
    !name.trim() ||
    idTaken ||
    !engine ||
    (draft?.configInputs.some(
      (i) => i.required && !(values[`${i.target}:${i.name}`] ?? values[i.name])?.trim(),
    ) ?? false);
  return { engine, draft, idTaken, missingRequired };
}

/** 落位预览纯函数(复杂度拆出):草稿 + 填值 → 掩码 JSON;JSON 家补显式 type(claude 磁盘实证)。 */
function buildPreview(
  draft: InstallDraft | undefined,
  values: Record<string, string>,
  engine: McpEngineState | null,
): string {
  if (!draft) return "";
  const entry = applyDraftValues(draft, values);
  const final: McpServerEntry =
    engine?.format === "json" ? { ...entry, type: inferTransport(entry) } : entry;
  return maskForPreview(final, draft);
}

export function InstallDraftModal({
  card,
  engines,
  defaultEngine,
  onClose,
}: {
  card: RegistryCard;
  engines: McpEngineState[];
  defaultEngine: McpEngineState | null;
  onClose: () => void;
}) {
  const [draftKind, setDraftKind] = useState<"install" | "manual">(
    card.installDraft ? "install" : "manual",
  );
  const [name, setName] = useState(() => slugify(card.name));
  const [profileId, setProfileId] = useState(defaultEngine?.profileId ?? engines[0]?.profileId ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyDetail = useCallback((detail: RegistryCard) => {
    setDraftKind(detail.installDraft ? "install" : "manual");
  }, []);
  const { resolved, resolving, error: resolveError } = useSmitheryResolve(card, applyDetail);
  const error = resolveError ?? saveError;

  const { engine, draft, idTaken, missingRequired } = useMemo(
    () => deriveModalState({ engines, profileId, resolved, draftKind, name, values }),
    [engines, profileId, resolved, draftKind, name, values],
  );

  const preview = useMemo(() => buildPreview(draft, values, engine), [draft, values, engine]);

  const save = async () => {
    if (!draft || !engine) return;
    setBusy(true);
    setSaveError(null);
    try {
      const entry = applyDraftValues(draft, values);
      if (engine.format === "json") entry.type = inferTransport(entry);
      await upsertServer(engine, name.trim(), entry);
      setSaved(true);
      window.setTimeout(onClose, 1500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title={t("安装 {name}", { name: card.name })}
      icon={<span className="text-xs">MCP</span>}
      width={620}
      locked={busy}
      onClose={onClose}
      footer={
        saved ? (
          <div className="text-right text-xs text-(--tmd-fg-faint)">
            {t("已保存,下次会话生效(不承诺即时生效)")}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            {error && <div className="max-w-full break-all text-meta text-(--tmd-diff-removed)">{error}</div>}
            <DialogActions
              confirmLabel={t("写入目标引擎")}
              confirmDisabled={missingRequired || busy || resolving || !draft}
              submitting={busy}
              onConfirm={() => void save()}
              onCancel={onClose}
            />
          </div>
        )
      }
    >
      {resolving ? (
        <div className="py-6 text-center text-xs text-(--tmd-fg-faint)">{t("正在拉取安装详情…")}</div>
      ) : !draft ? (
        <div className="py-6 text-center text-xs text-(--tmd-fg-faint)">
          {t("此卡片无可生成的安装草稿(需手动配置)")}
        </div>
      ) : (
        <DraftFormBody
          resolved={resolved}
          draft={draft}
          draftKind={draftKind}
          onDraftKindChange={setDraftKind}
          name={name}
          onNameChange={setName}
          engines={engines}
          profileId={profileId}
          onEngineChange={setProfileId}
          idTaken={idTaken}
          values={values}
          setValues={setValues}
          preview={preview}
        />
      )}
    </DialogShell>
  );
}

/** 草稿表单主体(复杂度拆出):双草稿切换 + 名称/引擎行 + 模板填空 + 落位预览。 */
function DraftFormBody(props: {
  resolved: RegistryCard;
  draft: InstallDraft;
  draftKind: "install" | "manual";
  onDraftKindChange: (kind: "install" | "manual") => void;
  name: string;
  onNameChange: (value: string) => void;
  engines: McpEngineState[];
  profileId: string;
  onEngineChange: (value: string) => void;
  idTaken: boolean;
  values: Record<string, string>;
  setValues: Dispatch<SetStateAction<Record<string, string>>>;
  preview: string;
}) {
  const { resolved, draft, draftKind, onDraftKindChange, name, onNameChange } = props;
  const { engines, profileId, onEngineChange, idTaken, values, setValues, preview } = props;
  return (
    <div className="flex flex-col gap-3 text-xs">
      {resolved.installDraft && resolved.manualDraft ? (
        <div className="flex gap-1">
          <button type="button" aria-pressed={draftKind === "install"} className={`mcphub-seg-btn ${draftKind === "install" ? "is-on" : ""}`} onClick={() => onDraftKindChange("install")}>
            {t("远程直连")}
          </button>
          <button type="button" aria-pressed={draftKind === "manual"} className={`mcphub-seg-btn ${draftKind === "manual" ? "is-on" : ""}`} onClick={() => onDraftKindChange("manual")}>
            {t("本地 stdio")}
          </button>
        </div>
      ) : draftKind === "manual" ? (
        <p className="text-meta leading-relaxed text-(--tmd-fg-faint)">
          {t("命令来自 registry 包指引,请确认后再写入")}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-(--tmd-fg-faint)">{t("server 名称(同文件内唯一)")}</span>
          <input className="mcphub-input" value={name} aria-label={t("server 名称(同文件内唯一)")} onChange={(e) => onNameChange(e.target.value)} />
          {idTaken && <span className="text-meta text-(--tmd-diff-removed)">{t("同名 server 已存在,请改名或先删除旧条目")}</span>}
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-(--tmd-fg-faint)">{t("目标引擎")}</span>
          <StyledSelect
            value={profileId}
            ariaLabel={t("目标引擎")}
            options={engines.map((e) => ({ value: e.profileId, label: e.name }))}
            onChange={onEngineChange}
          />
        </label>
      </div>

      {draft.configInputs.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-(--tmd-fg-faint)">{t("模板填空(必填项完成后可写入)")}</span>
          {draft.configInputs.map((input) => (
            <label key={`${input.target}:${input.name}`} className="flex items-center gap-2">
              <span className="w-40 flex-none truncate text-(--tmd-fg-muted)" title={input.label}>
                {input.label}
                {input.required ? " *" : ""}
                <span className="ml-1 text-(--tmd-fg-faint)">{input.target}</span>
              </span>
              <div className="min-w-0 flex-1">
                {input.secret ? (
                  <SecretInput
                    id={`mcphub-draft-${input.target}-${input.name}`}
                    value={values[`${input.target}:${input.name}`] ?? ""}
                    onChange={(v) => setValues((s) => ({ ...s, [`${input.target}:${input.name}`]: v }))}
                  />
                ) : (
                  <input
                    className="mcphub-input"
                    value={values[`${input.target}:${input.name}`] ?? ""}
                    aria-label={input.label}
                    onChange={(e) => setValues((s) => ({ ...s, [`${input.target}:${input.name}`]: e.target.value }))}
                  />
                )}
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-(--tmd-fg-faint)">{t("落位预览(将写入的 server 形状)")}</span>
        <pre className="mcphub-raw">{preview}</pre>
      </div>
    </div>
  );
}
