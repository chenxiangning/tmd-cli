/**
 * 提示词 tab —— 设置 section「智能体 / 提示词」的提示词管理页:
 * 作用域筛选(全部 / 全局 / 工作区)+ 搜索;新建 / 编辑 / 删除(废纸篓)/
 * 移到工作区 ⇄ 全局;导入:codemoss 全局目录(~/.codex/prompts)与
 * 「从目录导入…」(pickDirectory 自选,codemoss 工作区级目录由此兜底)。
 * 工作区级归属当前活跃工作区(kernel/workspace activeId)。
 */

import { useEffect, useRef, useState } from "react";
import { ArrowsLeftRight, DownloadSimple, FolderOpen, Pencil, Plus, Trash } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { pickDirectory } from "@kernel/ipc";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { useEscClose } from "@kernel/DialogShell";
import { StyledSelect } from "@kernel/StyledSelect";
import { useWorkspaces } from "@kernel/workspace";
import { importCodemossPrompts, importPromptDir, type ImportReport } from "../importCodemoss";
import { deletePrompt, movePrompt, savePrompt } from "../promptStore";
import { useAssets, type PromptEntry, type PromptScope } from "../store";

type ScopeFilter = "all" | PromptScope;

export function PromptTab() {
  const { prompts } = useAssets();
  const workspaces = useWorkspaces();
  const activeWsId = workspaces.activeId;
  const [filter, setFilter] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PromptEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<PromptEntry | null>(null);
  const [report, setReport] = useState("");

  const visible = prompts.filter((p) => {
    if (filter !== "all" && p.scope !== filter) return false;
    if (p.scope === "workspace" && p.wsId !== activeWsId) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return p.name.toLowerCase().includes(needle) || (p.description ?? "").toLowerCase().includes(needle);
  });

  const showReport = (r: ImportReport | null, failText: string) => {
    setReport(r ? t("导入 {n} 条提示词,跳过 {s} 条", { n: r.prompts, s: r.skipped }) : failText);
  };

  const importFromDir = async () => {
    const dir = await pickDirectory(t("选择提示词 md 目录"));
    if (!dir) return;
    showReport(await importPromptDir(dir).catch(() => null), t("导入失败:目录不可读"));
  };

  const importFromCodemoss = async () => {
    showReport(await importCodemossPrompts(), t("导入失败:~/.codex/prompts 不可读"));
  };

  const movePromptAcross = async (p: PromptEntry) => {
    const ok = await movePrompt(p, p.scope === "global" ? "workspace" : "global", activeWsId ?? undefined);
    if (!ok) setReport(t("移动失败:目标作用域重名或写入失败"));
  };

  return (
    <div className="assets-tab">
      <div className="assets-toolbar">
        <StyledSelect
          ariaLabel={t("作用域筛选")}
          value={filter}
          options={[
            { value: "all", label: t("全部") },
            { value: "global", label: t("全局") },
            { value: "workspace", label: t("工作区") },
          ]}
          onChange={(v) => setFilter(v as ScopeFilter)}
        />
        <input
          className="assets-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("搜索名称或描述…")}
        />
        <button type="button" className="assets-btn is-primary" onClick={() => setEditing("new")}>
          <Plus size="0.75rem" /> {t("新建")}
        </button>
        <button
          type="button"
          className="assets-btn"
          onClick={() => void importFromCodemoss()}
        >
          <DownloadSimple size="0.75rem" /> {t("从 codemoss 导入")}
        </button>
        <button type="button" className="assets-btn" onClick={() => void importFromDir()}>
          <FolderOpen size="0.75rem" /> {t("从目录导入…")}
        </button>
      </div>
      {report && <div className="assets-report">{report}</div>}
      {visible.length === 0 ? (
        <div className="assets-empty">
          {t("没有匹配的提示词。新建一个,或从 codemoss / 目录导入;composer 里 !! 选中即把正文插入输入框。")}
        </div>
      ) : (
        <div className="assets-card-list">
          {visible.map((p) => (
            <div className="assets-card" key={`${p.scope}:${p.wsId ?? ""}:${p.name}`}>
              <div className="assets-card-main">
                <div className="assets-card-name">
                  {p.name}
                  <span className="assets-scope-chip">{p.scope === "global" ? t("全局") : t("工作区")}</span>
                </div>
                {p.description && <div className="assets-card-desc">{p.description}</div>}
                {p.argumentHint && <div className="assets-card-hint">{t("参数: {hint}", { hint: p.argumentHint })}</div>}
              </div>
              <div className="assets-card-actions">
                <button type="button" className="assets-btn" onClick={() => setEditing(p)}>
                  <Pencil size="0.75rem" /> {t("编辑")}
                </button>
                <button
                  type="button"
                  className="assets-btn"
                  disabled={p.scope === "workspace" && !activeWsId}
                  onClick={() => void movePromptAcross(p)}
                >
                  <ArrowsLeftRight size="0.75rem" /> {p.scope === "global" ? t("移到工作区") : t("移到全局")}
                </button>
                <button
                  type="button"
                  className="assets-btn is-danger"
                  onClick={() => setDeleting(p)}
                >
                  <Trash size="0.75rem" /> {t("删除")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <PromptModal
          entry={editing === "new" ? null : editing}
          activeWsId={activeWsId}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("删除提示词")}
          message={t("删除提示词「{name}」?(进废纸篓)", { name: deleting.name })}
          confirmLabel={t("删除")}
          danger
          onConfirm={() => void deletePrompt(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** 草稿脏判定:任一字段偏离初始值(纯函数抽离降组件复杂度)。 */
function promptDraftDirty(
  d: { name: string; description: string; argumentHint: string; content: string; scope: PromptScope },
  entry: PromptEntry | null,
): boolean {
  return (
    d.name !== (entry?.name ?? "") ||
    d.description !== (entry?.description ?? "") ||
    d.argumentHint !== (entry?.argumentHint ?? "") ||
    d.content !== (entry?.content ?? "") ||
    d.scope !== (entry?.scope ?? "global")
  );
}

/** 提交前校验:返回错误文案或 null(wsId 由调用方按 scope 解析后传入)。 */
function promptSubmitError(name: string, scope: PromptScope, wsId: string | undefined): string | null {
  if (!name.trim()) return t("名称必填");
  if (scope === "workspace" && !wsId) return t("无活跃工作区,无法保存到工作区级");
  return null;
}

function PromptModal({
  entry,
  activeWsId,
  onClose,
}: {
  entry: PromptEntry | null;
  activeWsId: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [argumentHint, setArgumentHint] = useState(entry?.argumentHint ?? "");
  const [content, setContent] = useState(entry?.content ?? "");
  const [scope, setScope] = useState<PromptScope>(entry?.scope ?? "global");
  const [error, setError] = useState("");
  /* 挂载即聚焦首个输入(autofocus 属性是 react-doctor no-autofocus 反模式)。 */
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /* 键盘回路:Esc 关弹层(与点背板取消同义)。 */
  useEscClose(onClose);

  /* 脏态守卫:有草稿时点背板不关(防误击丢稿;判定抽纯函数降复杂度)。 */
  const dirty = promptDraftDirty({ name, description, argumentHint, content, scope }, entry);

  const submit = async () => {
    const wsId = scope === "workspace" ? (entry?.wsId ?? activeWsId ?? undefined) : undefined;
    const invalid = promptSubmitError(name, scope, wsId);
    if (invalid) {
      setError(invalid);
      return;
    }
    const ok = await savePrompt(scope, wsId, { name, description, argumentHint, content }, entry?.name);
    if (!ok) {
      setError(t("名称含非法字符、同作用域重复,或写入磁盘失败"));
      return;
    }
    onClose();
  };

  return (
    <div
      className="assets-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (!dirty && e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        open
        className="assets-modal"
        aria-label={entry ? t("编辑提示词") : t("新建提示词")}
      >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="assets-modal-title">{entry ? t("编辑提示词") : t("新建提示词")}</div>
        <label className="assets-field">
          <span>{t("名称(!! 触发时的调用名)")}</span>
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="assets-field">
          <span>{t("描述(可空)")}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="assets-field">
          <span>{t("参数提示(可空,如:PR 号, 重点)")}</span>
          <input value={argumentHint} onChange={(e) => setArgumentHint(e.target.value)} />
        </label>
        <label className="assets-field">
          <span>{t("正文($NAME 大写占位符,插入后手填)")}</span>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
        </label>
        <div className="assets-field">
          <span>{t("作用域")}</span>
          <StyledSelect
            ariaLabel={t("作用域")}
            value={scope}
            disabled={!!entry}
            options={[
              { value: "global", label: t("全局") },
              {
                value: "workspace",
                label: t("工作区(当前活跃工作区)"),
                disabled: !activeWsId,
              },
            ]}
            onChange={(v) => setScope(v as PromptScope)}
          />
        </div>
        {error && <div className="assets-error">{error}</div>}
        <div className="assets-modal-actions">
          <button type="button" className="assets-btn" onClick={onClose}>{t("取消")}</button>
          <button type="submit" className="assets-btn is-primary">{t("保存")}</button>
        </div>
      </form>
      </dialog>
    </div>
  );
}
