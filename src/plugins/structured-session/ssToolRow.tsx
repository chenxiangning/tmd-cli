/**
 * RPC 工具行 —— 对照 codemoss ProcessDisclosure 的过程组形态:
 * 头部 = 状态图标(Spinner/✓/✕) + 工具标签 + 类型 chip + 目标文件 chip +
 * chevron;展开区 = 命令预览 + 实时输出(running 自动展开/终态折叠/手动接管
 * 单卡状态机沿用)。落定折叠组传入 rail = 渲染为树形导轨行(li + SVG 弯枝
 * 描画 + 行模糊淡入,入场动画见 structured-session.css);活轮平铺不传。
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react";
import type { CliTranscriptBlock } from "@kernel/cli";
import { Spinner } from "@kernel/Spinner";
import { t } from "@kernel/i18n";
import { tailLines } from "@plugins/session-viewer/transcriptPhases";
import { toolRowMeta, type SsToolTypeKey } from "./ssToolMeta";

/** 类型键 → chip 文案(词典键在 locales/en|ja.ts)。 */
const TYPE_LABEL: Record<SsToolTypeKey, string> = {
  web: "搜索",
  shell: "命令工具",
  read: "读取",
  edit: "编辑",
  search: "查找",
  task: "子任务",
  tool: "工具",
};

/* 弯枝几何(codemoss RowConnector 同款:拐点钉在距行顶 14px 而非 50%,
 * 换行的行也在首行分叉);pathLength=1 走 CSS dash 描画,无需 motion 库。 */
const BRANCH_PATH = "M0.5 0 V8 Q0.5 14 6.5 14 H11.5";

/* 状态标(运行态统一 Spinner 原语 12px 行内档;终态 ✓/✕)。 */
function StatusMark({ status }: { status: string }) {
  if (status === "running") return <Spinner size="0.75rem" />;
  return (
    <span className={`ss-tool-mark${status === "error" ? " is-error" : ""}`} aria-hidden>
      {status === "error" ? "✕" : "✓"}
    </span>
  );
}

/* 展开区:命令预览 + 实时输出(running 只给尾段, monocode 律)。 */
function ToolBody({ meta, open }: { meta: ReturnType<typeof toolRowMeta>; open: boolean }) {
  if (!open) return null;
  return (
    <>
      {meta.cmdPreview ? <pre className="ss-toolrow-cmd">{meta.cmdPreview}</pre> : null}
      {meta.detail ? (
        <pre className={`ss-toolrow-out${meta.running ? " is-live" : ""}`}>
          {meta.running ? tailLines(meta.detail) : meta.detail}
        </pre>
      ) : null}
    </>
  );
}

/* 树形导轨:SVG 弯枝(描画入场,首行即刻、后续等上行干线 0.12s 再接笔)
 * + 1px 干线(scaleY 生长);末行不绘干线,导轨收在弯角。 */
function RowGuide({ first, last }: { first: boolean; last: boolean }) {
  const style = { "--ss-branch-delay": first ? "0s" : "0.12s" } as CSSProperties;
  return (
    <span className="ss-rowrail-guide" aria-hidden style={style}>
      <svg width="12" height="15" viewBox="0 0 12 15" fill="none">
        <path d={BRANCH_PATH} pathLength={1} />
      </svg>
      {last ? null : <span className="ss-rowrail-trunk" />}
    </span>
  );
}

export function SsToolRow({ block, rail }: { block: CliTranscriptBlock; rail?: { first: boolean; last: boolean } }) {
  const meta = toolRowMeta(block);
  const { running } = meta;
  const [manual, setManual] = useState<boolean | null>(null);
  /* null = 跟随自动律:running 展开 / 终态折叠;点击后手动接管。 */
  const open = manual ?? running;
  const inner: ReactNode = (
    <>
      <button
        type="button"
        className="ss-toolrow-head"
        aria-expanded={open}
        onClick={() => setManual(!(manual ?? running))}
      >
        <StatusMark status={meta.status} />
        <span className="ss-toolrow-label">{meta.label}</span>
        <span className={`ss-tool-chip ss-tool-chip-${meta.typeKey}`}>{t(TYPE_LABEL[meta.typeKey])}</span>
        {meta.chip ? <span className="ss-tool-file">{meta.chip}</span> : null}
        <CaretRight className="ss-tool-caret" aria-hidden />
      </button>
      <ToolBody meta={meta} open={open} />
    </>
  );
  if (!rail) {
    return <div className={`ss-toolrow${running ? " is-running" : ""}${open ? " is-open" : ""}`}>{inner}</div>;
  }
  return (
    <li className={`ss-toolrow ss-rowrail${running ? " is-running" : ""}${open ? " is-open" : ""}`}>
      <RowGuide first={rail.first} last={rail.last} />
      {inner}
    </li>
  );
}
