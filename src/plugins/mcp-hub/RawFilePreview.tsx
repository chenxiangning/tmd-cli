/**
 * 原始文件只读预览 —— 读引擎目标文件原文(<pre> 等宽展示,只读);
 * 附「在文件 tab 打开」(fileTabs.openFileInTab 深链,可继续编辑/对照)。
 * 只读定位:本预览不做任何编辑(编辑走 ServerEditModal 的结构化通道)。
 */
import { useEffect, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { openFileInTab } from "@kernel/fileTabs";
import { t } from "@kernel/i18n";
import type { McpEngineState } from "./hubStore";
import { readEngineRaw } from "./hubStore";

/** 预览字符上限(~/.claude.json 含 projects 历史可达数 MB,全量渲染卡 UI)。 */
const RAW_PREVIEW_CHARS = 20_000;

export function RawFilePreview({ engine, onClose }: { engine: McpEngineState; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void readEngineRaw(engine).then((raw) => {
      if (!alive) return;
      if (raw === null) setFailed(true);
      else {
        setTruncated(raw.length > RAW_PREVIEW_CHARS);
        setText(raw.slice(0, RAW_PREVIEW_CHARS));
      }
    });
    return () => {
      alive = false;
    };
  }, [engine]);

  return (
    <div className="mb-2 flex flex-col rounded-(--tmd-radius-md) border border-(--tmd-border)">
      <div className="flex items-center gap-2 border-b border-(--tmd-border) px-2.5 py-1.5 text-meta text-(--tmd-fg-faint)">
        <span className="truncate">{t("原始文件(只读)")} · {engine.path}</span>
        <div className="ml-auto flex flex-none items-center gap-1.5">
          {engine.exists && (
            <button type="button" className="mcphub-ghost-btn" onClick={() => openFileInTab(engine.path)}>
              <ArrowSquareOut size="0.75rem" aria-hidden />
              {t("在文件 tab 打开")}
            </button>
          )}
          <button type="button" className="mcphub-ghost-btn" onClick={onClose}>
            {t("关闭")}
          </button>
        </div>
      </div>
      {failed ? (
        <div className="px-3 py-3 text-meta text-(--tmd-diff-removed)">{t("文件不存在或不可读")}</div>
      ) : (
        <div>
          <pre className="mcphub-raw">{text ?? t("加载中…")}</pre>
          {truncated && (
            <div className="border-t border-(--tmd-border) px-2.5 py-1 text-2xs text-(--tmd-fg-faint)">
              {t("已达 20000 字符预览上限,完整内容请用「在文件 tab 打开」")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
