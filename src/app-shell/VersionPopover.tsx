/**
 * 版本弹窗 —— 点击侧栏底栏版本号弹出:自动更新 + 更新记录(内嵌 CHANGELOG)+ 在线检查。
 *
 * 数据纪律:
 * - 更新记录 = 打包内嵌的 CHANGELOG.md(updateCheck.CHANGELOG_ENTRIES),离线可看;
 * - 检查更新 = GitHub releases/latest 经 kernel quotaFetch,手动触发,失败静默显示
 *   失败态;发现新版后「前往下载」跳系统浏览器(升级路径演进见
 *   docs/superpowers/specs/2026-09-06-update-check-changelog-design.md);
 * - 自动更新 = tauri-plugin-updater latest.json 签名通道(autoUpdate.ts,codemoss
 *   同款),一键下载 + 安装 + 重启,负责「装」;atom 检查负责「发现」,两通道互补。
 * 呈现:portal 挂 body + 全屏透明 backdrop,backdrop / Escape / X 关闭;
 * useLayoutEffect 实测尺寸落位(锚点上方右对齐,视口夹取),与 ProxyPopover 同款。
 */

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, ArrowSquareOut, Cross } from "@phosphor-icons/react";
import { openExternalUrl } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import {
  CHANGELOG_ENTRIES,
  RELEASES_PAGE_URL,
  checkLatestRelease,
  isNewerVersion,
  type ChangelogEntry,
  type ReleaseInfo,
} from "./updateCheck";
import {
  AutoUpdateButton,
  AutoUpdateStatus,
  CheckActions,
  CheckResultView,
  InlineMarkdown,
  type CheckStatus,
} from "./VersionPopoverParts";

/** 视口安全边距与浮层-锚点垂直间距(px)。 */
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 8;

/** 更新记录:分页条 + 当前页条目(block key 取内容指纹,不用数组下标)。 */
function ChangelogPanel({
  entry,
  idx,
  entryCount,
  currentVersion,
  onPrev,
  onNext,
}: {
  entry: ChangelogEntry | undefined;
  idx: number;
  entryCount: number;
  currentVersion: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <div className="vp-changelog-bar">
        <span className="vp-changelog-label">{t("更新记录")}</span>
        {entryCount > 1 && (
          <span className="vp-pager">
            <button
              type="button"
              className="vp-pager-btn"
              aria-label={t("上一版本")}
              disabled={idx === 0}
              onClick={onPrev}
            >
              <CaretLeft size="0.8125rem" />
            </button>
            <span className="vp-pager-ind">
              {idx + 1} / {entryCount}
            </span>
            <button
              type="button"
              className="vp-pager-btn"
              aria-label={t("下一版本")}
              disabled={idx >= entryCount - 1}
              onClick={onNext}
            >
              <CaretRight size="0.8125rem" />
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
                <span className="vp-current-badge">{t("当前")}</span>
              )}
            </div>
            {entry.blocks.map((b) => (
              <div key={`${b.heading}:${b.items.join(";")}`} className="vp-block">
                {b.heading && <div className="vp-block-heading">{b.heading}</div>}
                <ul className="vp-items">
                  {b.items.map((item) => (
                    <li key={item}>
                      <InlineMarkdown text={item} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

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
  const popoverRef = useRef<HTMLDialogElement>(null);
  /* 检查请求代次:并发重试时旧响应不得清掉新请求的错误态。 */
  const checkGen = useRef(0);
  /* 兜底夹取:更新记录缩减(降级版本)时不越界。 */
  const entryCount = CHANGELOG_ENTRIES.length;
  const idx = Math.min(entryIndex, entryCount - 1);
  const entry = CHANGELOG_ENTRIES[idx];

  /* Esc 关闭;检查状态与翻页跨开合保留(上次结果可复看)。
     onClose 包 useEffectEvent:永远读到最新回调,但不作依赖触发重订阅。 */
  const onEscapeClose = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  });
  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onEscapeClose);
    return () => document.removeEventListener("keydown", onEscapeClose);
  }, [open]);

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
    const gen = ++checkGen.current;
    /* 即时反馈:按钮进 spinner + 禁用,提示行换「正在检查更新…」;网络慢时不再像点了没反应。 */
    setStatus("checking");
    setCheckError(null);
    const result = await checkLatestRelease();
    /* 代次守卫:慢的旧响应晚到时整包丢弃(含错误态清理)。 */
    if (gen !== checkGen.current) return;
    setRelease(result.release);
    if (result.error !== null) {
      setCheckError(result.error);
      setStatus("error");
      return;
    }
    /* 所有权感知的功能式更新:清错误态前再核代次,旧响应永不清新请求的错误。 */
    setCheckError((prev) => (gen === checkGen.current ? null : prev));
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
      <div className="vp-backdrop" role="presentation" onClick={onClose} />
      {/* 自制弹层换原生 dialog(非模态 open,不调 showModal);m-0 中和 UA 居中间距,
          其余 UA 默认(padding/border/background/position)均被 .vp-panel 显式覆盖。 */}
      <dialog
        ref={popoverRef}
        open
        className="vp-panel m-0"
        aria-label={t("版本与更新")}
        style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      >
        <div className="vp-header">
          <span className="vp-title">tmd-cli</span>
          <span className="vp-version-badge">v{currentVersion}</span>
          <button type="button" className="vp-close" aria-label={t("关闭")} onClick={onClose}>
            <Cross size="0.875rem" />
          </button>
        </div>

        {/* 动作行:三键一排,自动更新(签名通道,一键下载安装重启)是唯一主操作 */}
        <div className="vp-actions">
          <AutoUpdateButton />
          <CheckActions
            checking={status === "checking"}
            onCheck={() => void check()}
            onDownload={goDownload}
          />
        </div>
        <AutoUpdateStatus />
        <CheckResultView status={status} release={release} checkError={checkError} />

        <div className="vp-divider" />

        <ChangelogPanel
          entry={entry}
          idx={idx}
          entryCount={entryCount}
          currentVersion={currentVersion}
          onPrev={() => setEntryIndex(idx - 1)}
          onNext={() => setEntryIndex(idx + 1)}
        />

        <button
          type="button"
          className="vp-releases-link"
          onClick={() => void openExternalUrl(RELEASES_PAGE_URL)}
        >
          <ArrowSquareOut size="0.75rem" />
          {t("查看 GitHub Releases")}
        </button>
      </dialog>
    </>,
    document.body,
  );
}
