/**
 * 会话预设编辑表单(SessionPresetsDialog 拆件,300 行铁则;纯受控展示)。
 * 字段:名称 / 引擎下拉(候选 = defaultEngineCandidates,空候选整体禁存)/
 * 模型可选文本 / 提示词三态(无 · 引用库 · 自定义文本,二选一同约束)。
 * 校验就地报错,全部通过才回传 onSave(draft);样式随 WorktreeDialogBodies 家族。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import type { PromptEntry } from "@plugins/assets/store";
import { type PresetDraft, draftOf, type PresetPromptRef, type SessionPreset } from "./sessionPresets";

/** 引用下拉值编码(scope|wsId|name):三元组展平成单串,选回时还原。 */
function refKey(ref: PresetPromptRef): string {
  return `${ref.scope}|${ref.wsId ?? ""}|${ref.name}`;
}

function refFromKey(key: string): PresetPromptRef | null {
  const [scope, wsId, name] = key.split("|");
  if ((scope !== "global" && scope !== "workspace") || !name) return null;
  return { scope, wsId: wsId || undefined, name };
}

const inputCls =
  "rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)";

export function PresetFormCard({
  preset,
  candidates,
  prompts,
  wsNameById,
  busy,
  onSave,
  onCancel,
}: {
  /** 编辑目标;null = 新建。 */
  preset: SessionPreset | null;
  candidates: { id: string; name: string }[];
  /** 提示词库全量条目(工作区级条目带 wsId,下拉标注归属;悬空引用如实标失效)。 */
  prompts: PromptEntry[];
  wsNameById: Record<string, string>;
  busy: boolean;
  onSave: (draft: PresetDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(preset, candidates[0]?.id ?? ""));
  const [error, setError] = useState("");
  const set = (patch: Partial<PresetDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const noEngine = candidates.length === 0;

  /* 库引用选项:工作区级在前、全局在后,同名工作区覆盖全局(同 visiblePrompts 序);
   * 编辑中的悬空引用(库已无三元组)追加失效项,如实展示待改绑。 */
  const ordered = [...prompts].sort(
    (a, b) => (a.scope === "workspace" ? 0 : 1) - (b.scope === "workspace" ? 0 : 1) || a.name.localeCompare(b.name),
  );
  const seen = new Set<string>();
  const refOptions = ordered
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      value: refKey({ scope: p.scope, wsId: p.wsId, name: p.name }),
      label:
        p.name + (p.scope === "workspace" ? `(${wsNameById[p.wsId ?? ""] ?? t("工作区")})` : `(${t("全局")})`),
    }));
  const curRefKey = draft.ref ? refKey(draft.ref) : "";
  if (draft.ref && !refOptions.some((o) => o.value === curRefKey)) {
    refOptions.push({ value: curRefKey, label: `${draft.ref.name}(${t("已失效")})` });
  }

  const submit = () => {
    if (!draft.name.trim()) return setError(t("名称不能为空"));
    if (draft.promptMode === "text" && !draft.text.trim()) return setError(t("提示词文本不能为空"));
    if (draft.promptMode === "ref" && !draft.ref) return setError(t("请选择提示词"));
    onSave(draft);
  };

  const modes: [PresetDraft["promptMode"], string][] = [
    ["none", "无"],
    ["ref", "引用提示词库"],
    ["text", "自定义文本"],
  ];

  return (
    <div className="flex flex-col gap-2 text-xs text-(--tmd-fg)">
      <div className="font-medium">{preset ? t("编辑预设") : t("新建预设")}</div>
      {noEngine && (
        <div className="text-(--tmd-warn)">{t("未检测到可用引擎,请先启用引擎插件")}</div>
      )}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-right text-(--tmd-fg-faint)">{t("名称")}</span>
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          className={`${inputCls} min-w-0 flex-1`}
          aria-label={t("名称")}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-right text-(--tmd-fg-faint)">{t("引擎")}</span>
        <select
          value={draft.engineId}
          disabled={noEngine}
          onChange={(e) => set({ engineId: e.target.value })}
          className={`${inputCls} min-w-0 flex-1 disabled:opacity-50`}
          aria-label={t("引擎")}
        >
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-right text-(--tmd-fg-faint)">{t("模型")}</span>
        <input
          value={draft.model}
          onChange={(e) => set({ model: e.target.value })}
          placeholder={t("可选,留空用引擎默认")}
          className={`${inputCls} min-w-0 flex-1`}
          aria-label={t("模型")}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-right text-(--tmd-fg-faint)">{t("提示词")}</span>
        <div className="flex min-w-0 flex-1 gap-1" role="radiogroup" aria-label={t("提示词")}>
          {modes.map(([mode, label]) => (
            <label key={mode} className="flex items-center gap-1 text-xs">
              <input
                type="radio"
                name="preset-prompt-mode"
                checked={draft.promptMode === mode}
                onChange={() => set({ promptMode: mode })}
              />
              {t(label)}
            </label>
          ))}
        </div>
      </div>
      {draft.promptMode === "ref" && (
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-right text-(--tmd-fg-faint)">{t("提示词")}</span>
          <select
            value={draft.ref ? refKey(draft.ref) : ""}
            onChange={(e) => set({ ref: refFromKey(e.target.value) })}
            className={`${inputCls} min-w-0 flex-1`}
            aria-label={t("选择提示词…")}
          >
            <option value="">{t("选择提示词…")}</option>
            {refOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {draft.promptMode === "text" && (
        <textarea
          value={draft.text}
          onChange={(e) => set({ text: e.target.value })}
          rows={4}
          placeholder={t("随会话注入的初始提示词全文")}
          className={`${inputCls} min-w-0 flex-1 resize-y`}
          aria-label={t("提示词文本")}
        />
      )}
      {error && <div className="text-(--tmd-danger, #e5484d)">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
        >
          {t("取消")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || noEngine}
          className="rounded-md bg-(--tmd-accent) px-2.5 py-1 text-xs font-medium text-(--tmd-accent-fg) disabled:opacity-50"
        >
          {t("保存")}
        </button>
      </div>
    </div>
  );
}
