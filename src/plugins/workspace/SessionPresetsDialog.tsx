/**
 * 会话预设管理弹层(workspace 插件 · 候选4;工作区右键菜单「管理预设…」入口,
 * 弹层归调用方持有 —— 菜单卸载不连带杀弹层,同 WorktreeSessionDialog 先例)。
 * portal + useEscClose + useFocusTrap + busy 禁关;上列表(编辑/两步确认删除)
 * 下表单(PresetFormCard),CRUD 走 ./sessionPresets(内存单源 + 落盘)。
 */

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useEscClose } from "@kernel/DialogShell";
import { useFocusTrap } from "@kernel/useFocusTrap";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useAssets } from "@plugins/assets/store";
import { defaultEngineCandidates } from "@plugins/workbench/defaultEngine";
import { deletePreset, type PresetDraft, savePreset, useSessionPresets, type PresetPrompt, type SessionPreset } from "./sessionPresets";
import { PresetFormCard } from "./PresetFormCard";

/** draft → 存储形态(三态归一:无 = undefined;引用 = 三元组;内联 = 文本)。 */
function promptOf(draft: PresetDraft): PresetPrompt | undefined {
  if (draft.promptMode === "ref") return draft.ref ? { ref: draft.ref } : undefined;
  if (draft.promptMode === "text") return { text: draft.text };
  return undefined;
}

export function SessionPresetsDialog({ onClose }: { onClose: () => void }) {
  const { presets } = useSessionPresets();
  const { prompts } = useAssets();
  const { list: workspaces } = useWorkspaces();
  const candidates = defaultEngineCandidates();
  /** 编辑中的预设 id(null = 表单关闭或新建;新建无 id 亦可由 editing === "new" 表达)。 */
  const [editing, setEditing] = useState<SessionPreset | "new" | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const closeGuarded = useCallback((): void => {
    if (busy) return; /* 落盘中禁关:防 fire-and-forget 残留。 */
    onClose();
  }, [busy, onClose]);
  useEscClose(closeGuarded);
  const dialogRef = useFocusTrap(true);

  /* 工作区 id → 别名/名(下拉标注工作区级提示词归属)。 */
  const wsNameById: Record<string, string> = {};
  for (const ws of workspaces) wsNameById[ws.id] = ws.name;

  const save = async (draft: PresetDraft) => {
    const target = editing === "new" ? null : editing;
    if (presets.some((p) => p.id !== target?.id && p.name.toLowerCase() === draft.name.trim().toLowerCase())) {
      setError(t("预设名已存在"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await savePreset({
        id: target?.id,
        name: draft.name,
        engineId: draft.engineId,
        model: draft.model,
        prompt: promptOf(draft),
      });
      if (!saved) return setError(t("保存失败,请重试"));
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (armedId !== id) return setArmedId(id); /* 两步确认:首击武装,再击真删。 */
    setBusy(true);
    try {
      const ok = await deletePreset(id);
      if (!ok) setError(t("删除失败,请重试"));
      if (editing !== "new" && editing?.id === id) setEditing(null);
    } finally {
      setBusy(false);
      setArmedId(null);
    }
  };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 pt-[14vh]"
      data-icon-decor="dialog"
      onClick={(e) => e.target === e.currentTarget && closeGuarded()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("会话预设")}
        className="flex w-[440px] flex-col gap-3 rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-(--tmd-shadow-modal)"
      >
        <div className="flex items-center justify-between text-sm font-medium text-(--tmd-fg)">
          {t("会话预设")}
          <button type="button" onClick={closeGuarded} aria-label={t("关闭")} className="text-(--tmd-fg-faint) hover:text-(--tmd-fg)">
            <X size="0.875rem" />
          </button>
        </div>

        <div className="flex max-h-56 flex-col overflow-auto">
          {presets.length === 0 && (
            <div className="text-xs text-(--tmd-fg-faint)">{t("暂无预设")}</div>
          )}
          {presets.map((preset) => {
            const engine = host.getCliProfile(preset.engineId);
            const isEditing = editing !== "new" && editing?.id === preset.id;
            return (
              <div
                key={preset.id}
                className={`flex items-center gap-2 rounded-md px-1 py-1 text-xs${isEditing ? " bg-(--surface-hover)" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate text-(--tmd-fg)">{preset.name}</span>
                <span className="shrink-0 text-(--tmd-fg-faint)">
                  {engine ? engine.name : t("引擎不可用")}
                </span>
                <button
                  type="button"
                  aria-label={t("编辑预设")}
                  title={t("编辑预设")}
                  onClick={() => {
                    setEditing(preset);
                    setError("");
                  }}
                  className="text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
                >
                  <PencilSimple size="0.75rem" />
                </button>
                <button
                  type="button"
                  aria-label={t("删除预设")}
                  title={armedId === preset.id ? t("再点一次确认删除") : t("删除预设")}
                  onClick={() => void remove(preset.id)}
                  className={armedId === preset.id ? "text-(--tmd-danger, #e5484d)" : "text-(--tmd-fg-faint) hover:text-(--tmd-fg)"}
                >
                  <Trash size="0.75rem" />
                </button>
              </div>
            );
          })}
        </div>

        {editing === null ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="self-start rounded-md border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
          >
            {t("新建预设")}
          </button>
        ) : (
          <PresetFormCard
            key={editing === "new" ? "new" : editing.id}
            preset={editing === "new" ? null : editing}
            candidates={candidates}
            prompts={prompts}
            wsNameById={wsNameById}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(draft) => void save(draft)}
          />
        )}
        {error && <div className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}
      </div>
    </div>,
    document.body,
  );
}
