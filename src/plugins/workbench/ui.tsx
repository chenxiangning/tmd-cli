/**
 * 工作台 · 基础 UI 件:徽标、进度条、确认弹窗、空态提示、附件行。
 * 弹窗走 kernel/DialogShell(原生 dialog + 点背板/Esc 收口,与 git 弹层族同骨架);
 * 语气色映射在 tone.ts(only-export-components 拆分)。
 */

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { openSessionViewTab, isSessionViewAvailable } from "@kernel/sessionViewTabs";
import type { SessionMeta } from "@kernel/ipc";
import { Eye, FileImage, Paperclip, TerminalWindow, X } from "@phosphor-icons/react";
import { toneVar } from "./tone";
import { bytes, UPDATE_KIND_LABELS, formatUpdateAt, sortUpdates } from "./kindLabels";
import { isImageAttachment } from "./workbenchFiles";
import { runIpc } from "./ipcToast";
import { openLink } from "./sessionOpen";
import type { Attachment, Project, ProjectTask, TaskSessionLink } from "./types";
import type { ProjectSessionsState } from "./useProjectSessions";

export function WbBadge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="wb-badge" style={{ color: toneVar(tone), borderColor: toneVar(tone) }}>
      {children}
    </span>
  );
}

export function WbProgress({ value, tone }: { value: number; tone?: string }) {
  return (
    <span className="wb-progress" title={`${value}%`}>
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: tone ? toneVar(tone) : "var(--tmd-accent)" }} />
    </span>
  );
}

export function WbEmpty({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="wb-empty">
      <p>{text}</p>
      {children}
    </div>
  );
}

/** 附件/图片放大预览(点遮罩或 Esc 关闭;capture 拦 Esc 防穿透关掉底层弹层)。 */
export function WbImgView({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div role="presentation" className="wb-imgview-backdrop" onClick={onClose}>
      <dialog open aria-label={name} className="wb-imgview" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={name} />
        <p>{name}</p>
      </dialog>
    </div>
  );
}

/** 轻确认弹窗(DialogShell 骨架;确认语义由调用方文案表达)。 */
export function WbConfirm({
  open, title, body, confirmLabel, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <DialogShell
      title={title}
      icon={null}
      width={440}
      onClose={onCancel}
      footer={<DialogActions confirmLabel={confirmLabel} onConfirm={onConfirm} onCancel={onCancel} />}
    >
      {body ? <div className="wb-modal-body">{body}</div> : null}
    </DialogShell>
  );
}

/** 附件上传控件(钮 + 隐藏 file input):任务详情把它放进顶部操作行,
 *  文档编辑器仍由 WbAttachmentSection 内联渲染。onUpload 返回 Promise 时
 *  按钮进入 in-flight 态(禁用防连点),大文件 base64 编码期间不再无反馈。 */
export function WbAttachmentUpload({ onUpload }: { onUpload: (file: File) => unknown }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="wb-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Paperclip size={12} />{busy ? t("上传中…") : t("上传")}
      </button>
      <input
        ref={fileRef} type="file" hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || busy) return;
          setBusy(true);
          Promise.resolve(onUpload(file)).catch(() => undefined).finally(() => setBusy(false));
        }}
      />
    </>
  );
}

/** 附件区(文档编辑器与任务详情逐字重复收敛至此):标题计数 + 上传钮 +
 *  隐藏 file input + 附件行列表;上传实现与打开/删除动作由调用方注入。
 *  删除先经 WbConfirm 二次确认(删实体文件,不可恢复)。 */
export function WbAttachmentSection({ items, onUpload, onOpen, onDelete, onToast, hideUpload }: {
  items: Attachment[];
  onUpload: (file: File) => void;
  onOpen: (att: Attachment) => void;
  onDelete: (att: Attachment) => Promise<unknown>;
  onToast: (message: string) => void;
  /** 上传控件外置(任务详情顶部操作行)时置 true,段内不再渲染。 */
  hideUpload?: boolean;
}) {
  const [askDelete, setAskDelete] = useState<Attachment | null>(null);
  return (
    <section className="wb-taskdetail-sec">
      <h4>{t("附件")}<span className="wb-panel-sub">{items.length}</span></h4>
      {!hideUpload && (
        <div className="wb-taskdetail-actions">
          <WbAttachmentUpload onUpload={onUpload} />
        </div>
      )}
      <ul className="wb-attach-list">
        {items.map((att) => (
          <li key={att.id} className="wb-attach-row">
            <span className="wb-attach-ico">{isImageAttachment(att.fileName) ? <FileImage size={13} /> : <Paperclip size={13} />}</span>
            <button type="button" className="wb-link" onClick={() => onOpen(att)}>{att.name}</button>
            <span className="wb-attach-meta">{bytes(att.size)}</span>
            <button
              type="button" className="wb-btn wb-btn-xs wb-attach-del" aria-label={t("删除")}
              onClick={() => setAskDelete(att)}
            ><X size={11} /></button>
          </li>
        ))}
      </ul>
      {askDelete ? (
        <WbConfirm
          open
          title={t("删除附件")}
          body={t("将删除附件「{name}」,不可恢复。", { name: askDelete.name })}
          confirmLabel={t("删除")}
          onConfirm={() => {
            runIpc(onDelete(askDelete), onToast, t("附件已删除"));
            setAskDelete(null);
          }}
          onCancel={() => setAskDelete(null)}
        />
      ) : null}
    </section>
  );
}

/** 执行记录段(AI 回写时间线;时间正序,新记录自然展开在下;无增删入口)。
 *  自 TaskDetailView 拆入守 300 行铁则。 */
export function TaskUpdatesSec({ updates }: { updates: ProjectTask["updates"] }) {
  return (
    <section className="wb-taskdetail-sec">
      <h4>{t("执行记录")}<span className="wb-panel-sub">{updates.length}</span></h4>
      {updates.length > 0 ? (
        <ul className="wb-update-list">
          {sortUpdates(updates, "asc").map((update) => (
            <li key={update.id} className={`wb-update-row is-${update.kind}`}>
              <i className="wb-update-dot" aria-hidden />
              <div className="wb-update-body">
                <span className="wb-update-meta">{formatUpdateAt(update.at)} · {t(UPDATE_KIND_LABELS[update.kind])}</span>
                <p>{update.text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wb-muted">{t("还没有执行记录;关联会话按 AI-TASKS.md 约定回写后自动在此展示。")}</p>
      )}
    </section>
  );
}

/** 会话行操作 pill 组:打开会话 + 查看转录(引擎支持转录 + 查看器在册 +
 * 身份齐全才出)。任务详情/会话页签/概要会话区三处同款;点击不冒泡,
 * 行体自身的点击(打开会话/跳页签)不被触发。 */
export function WbSessionActs({ link, project, workspaceId, recent, live, onToast }: {
  link: TaskSessionLink;
  project: Project;
  workspaceId: string | undefined;
  recent: ProjectSessionsState | null;
  live: SessionMeta | undefined;
  onToast: (message: string) => void;
}) {
  /* 转录身份装配:取已存 cliSessionId,host link 回退活表已绑定身份,
   * disk link 回退 ref 本身(与任务详情段同口径)。 */
  const cliSessionId = link.cliSessionId ?? (link.kind === "disk" ? link.ref : live?.cliSessionId);
  const canView =
    host.getCliProfile(link.profileId)?.readSessionTranscript !== undefined &&
    isSessionViewAvailable() && cliSessionId !== undefined;
  return (
    <span className="wb-sess-acts">
      <button
        type="button" className="wb-sess-pill"
        onClick={(e) => { e.stopPropagation(); openLink(link, project, workspaceId, onToast, recent); }}
      ><TerminalWindow size={12} />{t("打开会话")}</button>
      {canView ? (
        <button
          type="button" className="wb-sess-pill"
          onClick={(e) => {
            e.stopPropagation();
            openSessionViewTab({ profileId: link.profileId, cliSessionId, title: live?.title || link.title || link.ref, cwd: project.cwd });
          }}
        ><Eye size={12} />{t("查看转录")}</button>
      ) : null}
    </span>
  );
}
