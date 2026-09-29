/**
 * 预览抽屉 ── skill 元数据文件懒读展示。整文件头 200KB 上限,超出截断标记;
 * 无元数据(裸目录)显示目录名提示。编辑 = 深链中央文件 tab(全功能编辑器,
 * ⌘S 保存);公约位/共享卡删除影响面提示在 InstalledView 确认弹窗,这里只读。
 */

import { useEffect, useState } from "react";
import { PencilSimple, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { openFileInTab } from "@kernel/fileTabs";
import { resolveSkillMetaFile, type HubSkill } from "./skillScan";

const PREVIEW_CAP_BYTES = 200 * 1024;

export function SkillPreviewDrawer({
  skill,
  onClose,
}: {
  skill: HubSkill;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [missing, setMissing] = useState(false);
  const [metaFile, setMetaFile] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setTruncated(false);
    setMissing(false);
    setMetaFile(null);
    void (async () => {
      const file = await resolveSkillMetaFile(skill);
      if (!alive) return;
      setMetaFile(file);
      if (!file) {
        setMissing(true);
        return;
      }
      const head = await ipc.fsReadHead(file, PREVIEW_CAP_BYTES).catch(() => "");
      if (!alive) return;
      if (!head) {
        setMissing(true);
        return;
      }
      setText(head);
      /* 按字节判定(read_head 按字节截断;CJK 长内容字符数远小于字节数会漏标)。 */
      setTruncated(new TextEncoder().encode(head).length >= PREVIEW_CAP_BYTES);
    })();
    return () => {
      alive = false;
    };
  }, [skill]);

  return (
    <div
      className="absolute inset-y-0 right-0 z-20 flex w-[440px] max-w-full flex-col border-l border-(--tmd-border) bg-(--tmd-bg-elevated) shadow-2xl"
      data-skill-preview={skill.name}
    >
      <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-xs font-medium">{skill.name}</div>
        {metaFile && (
          <button
            type="button"
            onClick={() => openFileInTab(metaFile)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
            title={metaFile}
            data-skill-edit={skill.name}
          >
            <PencilSimple size={12} aria-hidden="true" />
            {t("编辑")}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          aria-label={t("关闭")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="border-b border-(--tmd-border) px-3 py-1.5 text-[10px] text-(--tmd-fg-faint)">
        <div className="truncate">{skill.dir}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {missing ? (
          <div className="text-xs text-(--tmd-fg-faint)">{t("无元数据文件,仅有目录名")}</div>
        ) : text === null ? (
          <div className="text-xs text-(--tmd-fg-faint)">{t("读取中…")}</div>
        ) : (
          <>
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-(--tmd-fg)">
              {text}
            </pre>
            {truncated && (
              <div className="mt-2 rounded bg-(--tmd-bg-sunken) px-2 py-1 text-[10px] text-(--tmd-fg-muted)">
                {t("已达 200KB 预览上限,超出部分已截断")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
