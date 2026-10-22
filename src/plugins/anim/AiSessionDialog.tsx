/**
 * anim · AI 会话确认弹窗:目标项目 link 卡片 + 引用卡片预览 + 可二次编辑的
 * 初始提示词。确认 = spawn 会话后提示词填入 composer 草稿、引用挂卡片
 * (不直写 PTY);取消零副作用。
 */
import { useState } from "react";
import { FileCode, FileText, FilmSlate } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell } from "@kernel/DialogShell";

/** 引用文件卡片输入(animSessionRefs 单源:协议材料 + 目标项目)。 */
export interface AiSessionRef {
  label: string;
  path: string;
  /** 卡片图标:"doc" = 文本文档(schema),"code" = 代码/数据(示例 json)。 */
  kind: "doc" | "code";
}

/** 弹窗输入:确认时按 path 决定 spawn cwd 与提示词锚点;stub=true 表示路径尚未落盘。 */
export interface AiSessionTarget {
  name: string;
  path: string;
  prompt: string;
  stub: boolean;
  refs: AiSessionRef[];
}

export function AiSessionDialog({
  target,
  submitting,
  onCancel,
  onConfirm,
}: {
  target: AiSessionTarget;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState(target.prompt);
  return (
    <DialogShell
      title={t("关联 AI 会话")}
      icon={<FilmSlate size="0.875rem" />}
      locked={submitting}
      onClose={onCancel}
      footer={
        <DialogActions
          className="mt-3"
          confirmLabel={t("启动会话")}
          confirmDisabled={prompt.trim() === ""}
          submitting={submitting}
          onConfirm={() => onConfirm(prompt)}
          onCancel={onCancel}
        />
      }
    >
      {/* link 卡片:会话目标一眼可辨(图标 + 项目名 + 落盘路径)。 */}
      <div className="mt-3 flex items-center gap-2.5 rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-2">
        <FilmSlate size="1.25rem" className="flex-none text-(--tmd-accent)" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-(--tmd-fg)">{target.name}</div>
          <div className="truncate font-mono text-[0.6875rem] text-(--tmd-fg-muted)" title={target.path}>
            {target.path}
          </div>
        </div>
        {target.stub && (
          <span className="flex-none rounded bg-(--tmd-accent-soft) px-1.5 py-0.5 text-[0.625rem] text-(--tmd-accent)">
            {t("新建项目桩")}
          </span>
        )}
      </div>
      {/* 引用文件卡片:与发送时自动拼回的引用块一一对应(路径不再占正文编辑区)。 */}
      <div className="mt-2 flex flex-col gap-1">
        {target.refs.map((ref) => (
          <div
            key={ref.path}
            className="flex items-center gap-2 rounded-md border border-(--tmd-border) px-2.5 py-1.5"
          >
            {ref.kind === "doc" ? (
              <FileText size="0.875rem" className="flex-none text-(--tmd-fg-muted)" />
            ) : (
              <FileCode size="0.875rem" className="flex-none text-(--tmd-fg-muted)" />
            )}
            <span className="flex-none text-xs text-(--tmd-fg)">{ref.label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-(--tmd-fg-muted)" title={ref.path}>
              {ref.path}
            </span>
          </div>
        ))}
      </div>
      <label htmlFor="anim-ai-prompt" className="mt-3 block text-xs text-(--tmd-fg-muted)">
        {t("初始提示词(启动后以卡片挂入,点卡片可再编辑)")}
      </label>
      <textarea
        id="anim-ai-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={9}
        disabled={submitting}
        className="mt-1 w-full resize-y rounded-md border border-(--tmd-border) bg-transparent px-2 py-1.5 font-mono text-xs leading-relaxed text-(--tmd-fg) outline-none focus:border-(--tmd-accent) disabled:opacity-50"
      />
    </DialogShell>
  );
}
