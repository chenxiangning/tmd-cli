/**
 * 设置页「工作区分组」tab —— 组 CRUD:新建 / 内联重命名 / 上移下移 / 删除。
 * 语义落点在 ../groups.ts(校验、保留名、删组回落未分组);
 * 样式复用 pref-row + tailwind 工具类,零新增 CSS。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { CaretDown, CaretUp, Plus, Trash } from "@phosphor-icons/react";
import { createGroup, deleteGroup, moveGroup, renameGroup } from "./groups";

const inputCls =
  "w-48 rounded-md border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)";
const btnCls =
  "inline-flex items-center gap-1 rounded-md border border-(--tmd-border) px-2 py-1 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-40 disabled:hover:bg-transparent";

export function WorkspaceGroupsTab() {
  const { settings } = useSettingsState();
  const groups = settings.workspaceGroups;
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const add = () => {
    const err = createGroup(newName);
    if (err) return setError(err);
    setNewName("");
    setError("");
  };
  const commitRename = (id: string) => {
    const draft = drafts[id];
    if (draft === undefined) return;
    const err = renameGroup(id, draft);
    if (err) return setError(err);
    setError("");
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  };

  return (
    <div className="pref-cluster">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("新建分组")}</div>
          <div className="pref-desc">
            {t("分组用于组织左侧栏的工作区;「未分组」是保留名。删除组后,组内工作区自动落回未分组。")}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            className={inputCls}
            /* IME 组词期 Enter 放行(仓内纪律,见 kernel/shortcuts.ts) */
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
            placeholder={t("组名")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="button" className={btnCls} onClick={add}>
            <Plus size="0.75rem" /> {t("新建")}
          </button>
        </div>
      </div>
      {error && <div className="pref-desc text-(--tmd-danger, #d64545)">{error}</div>}
      {groups.map((g, idx) => (
        <div className="pref-row" key={g.id}>
          <input
            aria-label={t("重命名 {name}", { name: g.name })}
            className={inputCls}
            value={drafts[g.id] ?? g.name}
            onChange={(e) => setDrafts({ ...drafts, [g.id]: e.target.value })}
            onBlur={() => commitRename(g.id)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={btnCls}
              title={t("上移")}
              disabled={idx === 0}
              onClick={() => moveGroup(g.id, "up")}
            >
              <CaretUp size="0.75rem" />
            </button>
            <button
              type="button"
              className={btnCls}
              title={t("下移")}
              disabled={idx === groups.length - 1}
              onClick={() => moveGroup(g.id, "down")}
            >
              <CaretDown size="0.75rem" />
            </button>
            <button
              type="button"
              className={btnCls}
              title={t("删除组")}
              onClick={() => {
                if (window.confirm(t("删除组「{name}」?组内工作区将移到未分组。", { name: g.name })))
                  deleteGroup(g.id);
              }}
            >
              <Trash size="0.75rem" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
