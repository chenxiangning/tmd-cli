/**
 * 工作台 · 抽屉「文档」页签(自 drawerTabs.tsx 拆出守 300 行铁则):
 * 列表(行 = 类型图标 + 标题 + 元信息 + 悬停删除)与编辑器(返回/内联标题/
 * 脏标记/保存 + 填满编辑区 + 底部附件)两态。写穿 store,失败经 onToast 上抛。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { ArrowLeft, File, FileImage, FileText, FloppyDisk, Plus, X } from "@phosphor-icons/react";
import { DOC_KIND_LABELS } from "./kindLabels";
import type { Project, ProjectDoc } from "./types";
import { attachDocFile, createDoc, deleteDoc, detachDocFile, readDoc, saveDoc } from "./store";
import { readDocDataUrl, fileToBase64, isImageAttachment, docAttachmentPath } from "./workbenchFiles";
import { openFileInTab } from "@kernel/fileTabs";
import { WbBadge, WbImgView, WbAttachmentSection } from "./ui";
import { DocEditor } from "./DocEditor";
import { runIpc } from "./ipcToast";

/** 文档类型图标(markdown / 图片 / 其余文件)。 */
function DocIcon({ doc }: { doc: ProjectDoc }) {
  if (doc.kind === "markdown") return <FileText size={14} />;
  if (doc.kind === "image") return <FileImage size={14} />;
  return <File size={14} />;
}

export function DrawerDocsTab({ project, onToast }: { project: Project; onToast: (message: string) => void }) {
  /* 编辑态只留 id:附件列表从 project.docs 派生(store 删附件行即消失,不留陈旧快照)。 */
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const openDoc = openDocId ? project.docs.find((d) => d.id === openDocId) ?? null : null;

  const openMarkdown = (doc: ProjectDoc) => {
    void readDoc(project.id, doc.id).then((text) => {
      setOpenDocId(doc.id);
      setTitleDraft(doc.title);
      setDraft(text);
      setDirty(false);
    }, (e) => onToast(e instanceof Error ? e.message : String(e)));
  };
  const createAndOpen = () => {
    void createDoc(project.id, { title: t("未命名文档") }).then(
      (doc) => { onToast(t("文档已创建")); openMarkdown(doc); },
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  };
  const upload = async (file: File) => {
    if (!openDoc) return;
    if (file.size > 24 * 1024 * 1024) {
      onToast(t("附件超过 24MB 上限"));
      return;
    }
    let bytesBase64: string; let size: number;
    try {
      ({ bytesBase64, size } = await fileToBase64(file));
    } catch {
      onToast(t("附件打开失败"));
      return;
    }
    void attachDocFile(project.id, openDoc.id, { name: file.name, bytesBase64, size }).then(
      () => onToast(t("附件已上传")),
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  };
  const previewImage = (item: { fileName: string; title?: string; name?: string }) => {
    void readDocDataUrl(project.id, item.fileName).then(
      (url) => {
        if (url) setPreview({ name: item.title ?? item.name ?? item.fileName, url });
        else onToast(t("附件读取失败"));
      },
      () => onToast(t("附件读取失败")),
    );
  };
  /* 附件点按:图片预览;其余直接以客户端文件 tab 打开(kernel 通道,标题用原名)。 */
  const openAttachment = (att: { fileName: string; name: string }) => {
    if (isImageAttachment(att.fileName)) { previewImage(att); return; }
    void docAttachmentPath(project.id, att.fileName).then((p) => { openFileInTab(p, att.name); }).catch(() => onToast(t("附件打开失败")));
  };

  const saveOpenDoc = () => {
    if (!openDoc) return;
    /* 成功才清 dirty:失败保留脏标记,保存钮可重试。 */
    void saveDoc(project.id, openDoc.id, { title: titleDraft, markdown: draft }).then(
      () => { onToast(t("文档已保存")); setDirty(false); },
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  };
  if (openDoc) {
    return (
      <div className="wb-docs is-editing">
        <div className="wb-doc-editor-head">
          <button type="button" className="wb-btn" onClick={() => { setOpenDocId(null); setDirty(false); }}>
            <ArrowLeft size={12} />{t("返回列表")}
          </button>
          <input
            className="wb-doc-title" value={titleDraft}
            onChange={(e) => { setTitleDraft(e.target.value); setDirty(true); }}
            aria-label={t("文档标题")}
          />
          {dirty ? <span className="wb-doc-dirty">{t("未保存")}</span> : null}
          <WbBadge tone="muted">{t(DOC_KIND_LABELS[openDoc.kind])}</WbBadge>
          <button
            type="button" className="wb-btn wb-btn-primary" disabled={!dirty}
            onClick={saveOpenDoc}
          ><FloppyDisk size={12} />{t("保存文档")}</button>
        </div>
        <DocEditor
          key={openDoc.id} value={draft}
          onChange={(v) => { setDraft(v); setDirty(true); }}
          onSave={saveOpenDoc}
        />
        <WbAttachmentSection
          items={openDoc.attachments}
          onUpload={upload}
          onOpen={openAttachment}
          onDelete={(att) => detachDocFile(project.id, openDoc.id, att.id)}
          onToast={onToast}
        />
        {preview ? <WbImgView name={preview.name} url={preview.url} onClose={() => setPreview(null)} /> : null}
      </div>
    );
  }
  return (
    <div className="wb-docs">
      <div className="wb-list-head">
        <h3>{t("资料文档")}<span className="wb-count">{project.docs.length}</span></h3>
        <button type="button" className="wb-btn wb-btn-primary" onClick={createAndOpen}>
          <Plus size={12} />{t("新建文档")}
        </button>
      </div>
      {project.docs.length === 0 ? (
        <p className="wb-muted">{t("还没有资料文档;新建 markdown,附件/图片在文档内上传。")}</p>
      ) : (
        <ul className="wb-attach-list">
          {project.docs.map((doc) => (
            <li key={doc.id} className="wb-attach-row">
              <span className="wb-attach-ico"><DocIcon doc={doc} /></span>
              {doc.kind === "markdown" ? (
                <button type="button" className="wb-link" onClick={() => openMarkdown(doc)}>{doc.title}</button>
              ) : (
                <button type="button" className="wb-link" onClick={() => previewImage(doc)}>{doc.title}</button>
              )}
              <span className="wb-attach-meta">
                {t(DOC_KIND_LABELS[doc.kind])}
                {doc.kind === "markdown" && doc.attachments.length > 0 ? ` · ${t("附件")} ${doc.attachments.length}` : ""}
                {" · "}{doc.updatedAt.slice(0, 10)}
              </span>
              <button
                type="button" className="wb-btn wb-btn-xs wb-attach-del" aria-label={t("删除")}
                onClick={() => runIpc(deleteDoc(project.id, doc.id), onToast, t("文档已删除"))}
              ><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      {preview ? <WbImgView name={preview.name} url={preview.url} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
