/**
 * 版本弹窗 —— 点击侧栏底栏版本号弹出:更新记录(内嵌 CHANGELOG)+ 在线检查。
 *
 * 数据纪律:
 * - 更新记录 = 打包内嵌的 CHANGELOG.md(updateCheck.CHANGELOG_ENTRIES),离线可看;
 * - 检查更新 = GitHub releases/latest 经 kernel quotaFetch,手动触发,失败静默显示
 *   失败态;发现新版后「前往下载」跳系统浏览器(产物未签名,无应用内安装,
 *   升级路径见 docs/superpowers/specs/2026-09-06-update-check-changelog-design.md)。
 * 呈现:portal 挂 body + 全屏透明 backdrop,backdrop / Escape / X 关闭;
 * useLayoutEffect 实测尺寸落位(锚点上方右对齐,视口夹取),与 ProxyPopover 同款。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, DownloadSimple, ArrowSquareOut, ArrowClockwise, Cross } from "@phosphor-icons/react";
import { openExternalUrl } from "@kernel/ipc";
import {
  CHANGELOG_ENTRIES,
  RELEASES_PAGE_URL,
  checkLatestRelease,
  isNewerVersion,
  type ReleaseInfo,
} from "./updateCheck";

/** 视口安全边距(px)。 */
const VIEWPORT_MARGIN = 12;
/** 浮层与锚点(底栏上缘)的垂直间距(px)。 */
const ANCHOR_GAP = 8;

type CheckStatus = "idle" | "checking" | "latest" | "outdated" | "error";


/** 非 error 态的一行提示;outdated 走高亮横幅,error 走红色原因行。 */
const STATUS_TEXT: Record<"idle" | "checking" | "latest", string> = {
  idle: "点击「检查更新」查询 GitHub 最新发布版本。",
  checking: "正在检查更新…",
  latest: "已是最新版本。",
};

export function VersionPopover({
  open,
  anchor,
  currentVersion,
  onClose,
}: {
  open: boolean;
  anchor: { x: number; y: number };
  currentVersion: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<CheckStatus>("idle");
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  /* 更新记录分页:每页一个版本,0 = 最新一版。 */
  const [entryIndex, setEntryIndex] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const entryCount = CHANGELOG_ENTRIES.length;
  /* 兜底夹取:更新记录缩减(降级版本)时不越界。 */
  const idx = Math.min(entryIndex, entryCount - 1);
  const entry = CHANGELOG_ENTRIES[idx];

  /* Esc 关闭;检查状态与翻页跨开合保留(上次结果可复看)。 */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /* 实测定稿:右对齐锚点右缘、悬于底栏上方,视口四边夹取。 */
  useLayoutEffect(() => {
    if (!open) return;
    const el = popoverRef.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(VIEWPORT_MARGIN, anchor.x - w), vw - VIEWPORT_MARGIN - w);
    const top = Math.max(VIEWPORT_MARGIN, Math.min(anchor.y - ANCHOR_GAP - h, vh - VIEWPORT_MARGIN - h));
    setPos({ left, top });
  }, [open, anchor]);

  if (!open) return null;

  const check = async () => {
    const result = await checkLatestRelease();
    setRelease(result.release);
    if (result.error !== null) {
      setCheckError(result.error);
      setStatus("error");
      return;
    }
    setCheckError(null);
    const latest = result.release;
    const outdated = isNewerVersion(latest.version, currentVersion);
    setStatus(outdated ? "outdated" : "latest");
    /* 发现新版且更新记录里有该版本 → 自动翻到那一页。 */
    if (outdated) {
      const i = CHANGELOG_ENTRIES.findIndex((e) => e.version === latest.version);
      if (i >= 0) setEntryIndex(i);
    }
  };

  const goDownload = () => {
    void openExternalUrl(release?.htmlUrl ?? RELEASES_PAGE_URL);
  };

  return createPortal(
    <>
      <div className="vp-backdrop" onClick={onClose} />
      <div
        ref={popoverRef}
        className="vp-panel"
        role="dialog"
        aria-label="版本与更新"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      >
        <div className="vp-header">
          <span className="vp-title">tmd-cli</span>
          <span className="vp-version-badge">v{currentVersion}</span>
          <button type="button" className="vp-close" aria-label="关闭" onClick={onClose}>
            <Cross size={14} />
          </button>
        </div>

        <div className="vp-actions">
          <button
            type="button"
            className="vp-btn"
            onClick={() => void check()}
            disabled={status === "checking"}
          >
            <ArrowClockwise size={13} className={status === "checking" ? "vp-spin" : undefined} />
            {status === "checking" ? "检查中…" : "检查更新"}
          </button>
          <button type="button" className="vp-btn vp-btn-primary" onClick={goDownload}>
            <DownloadSimple size={13} />
            前往下载
          </button>
        </div>

        {status === "outdated" && release && (
          <div className="vp-outdated">
            <div className="vp-outdated-line">
              发现新版本
              <span className="vp-outdated-ver">v{release.version}</span>
              {release.publishedAt && (
                <span className="vp-date">{release.publishedAt.slice(0, 10)}</span>
              )}
            </div>
            {release.notes && <div className="vp-notes">{release.notes}</div>}
          </div>
        )}
        {status === "error" && checkError && (
          <div className="vp-status vp-status-err">{checkError}</div>
        )}
        {status !== "outdated" && status !== "error" && (
          <div className="vp-status">{STATUS_TEXT[status]}</div>
        )}

        <div className="vp-divider" />

        <div className="vp-changelog-bar">
          <span className="vp-changelog-label">更新记录</span>
          {entryCount > 1 && (
            <span className="vp-pager">
              <button
                type="button"
                className="vp-pager-btn"
                aria-label="上一版本"
                disabled={idx === 0}
                onClick={() => setEntryIndex(idx - 1)}
              >
                <CaretLeft size={13} />
              </button>
              <span className="vp-pager-ind">
                {idx + 1} / {entryCount}
              </span>
              <button
                type="button"
                className="vp-pager-btn"
                aria-label="下一版本"
                disabled={idx >= entryCount - 1}
                onClick={() => setEntryIndex(idx + 1)}
              >
                <CaretRight size={13} />
              </button>
            </span>
          )}
        </div>
        <div className="vp-changelog">
          {entry && (
            <div className="vp-entry">
              <div className="vp-entry-head">
                <span className="vp-entry-ver">v{entry.version}</span>
                {entry.date && <span className="vp-date">{entry.date}</span>}
                {entry.version === currentVersion && (
                  <span className="vp-current-badge">当前</span>
                )}
              </div>
              {entry.blocks.map((b, i) => (
                <div key={i} className="vp-block">
                  {b.heading && <div className="vp-block-heading">{b.heading}</div>}
                  <ul className="vp-items">
                    {b.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="vp-releases-link"
          onClick={() => void openExternalUrl(RELEASES_PAGE_URL)}
        >
          <ArrowSquareOut size={12} />
          查看 GitHub Releases
        </button>
      </div>
    </>,
    document.body,
  );
}
