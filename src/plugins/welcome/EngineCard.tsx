/**
 * 单引擎卡片 —— 探针状态 + 一键安装(indeterminate 进度条 + 流式日志)。
 *
 * 数据流:
 * - mount → ipc.cliProbe(binary) 探一次;安装完成后自动重探;
 * - 安装:订阅 cli-install://{engine} 事件流 → 日志追加(上限 200 行滚动);
 *   phase "done:ok" → 重探 + 收尾;"done:fail" → 红字收尾,日志保留可翻。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleX, ExternalLink, RefreshCw } from "lucide-react";
import {
  ipc,
  onCliInstallEvent,
  type CliInstallEvent,
  type CliProbeResult,
} from "@kernel/ipc";
import type { CliProfile } from "@kernel/cli";
import type { EngineMeta } from "./engineMeta";
import { isOutdated } from "./latestVersion";

/** 日志滚动上限(行)。npm 全量输出数千行,只留尾部。 */
const LOG_LINE_LIMIT = 200;

export type ProbeStatus = "loading" | "ok" | "notFound" | "error";

export interface EngineProbeState {
  status: ProbeStatus;
  result: CliProbeResult | null;
}

export interface InstallState {
  running: boolean;
  ok: boolean | null;
  lines: string[];
}

export function EngineCard({
  meta,
  profile,
  probe,
  latest,
  install,
  onProbe,
  onInstall,
}: {
  meta: EngineMeta;
  profile: CliProfile | undefined;
  probe: EngineProbeState;
  /** 最新版本:undefined=查询中,null=查询失败(不渲染),string=已拿到。 */
  latest: string | null | undefined;
  install: InstallState;
  onProbe: () => void;
  onInstall: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const outdated = isOutdated(probe.result?.version, latest ?? null);

  /* 日志追加时滚到底(用户上翻时不打断:仅当已贴底才跟滚)。 */
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (pinned) el.scrollTop = el.scrollHeight;
  }, [install.lines]);

  return (
    <section className="welcome-engine-card">
      <header className="welcome-engine-head">
        <span className="welcome-engine-icon" aria-hidden>
          {profile?.renderIcon ? profile.renderIcon(22) : <CircleX size={22} />}
        </span>
        <span className="welcome-engine-name">{meta.displayName}</span>
        {meta.docsUrl && (
          <a
            className="welcome-engine-docs"
            href={meta.docsUrl}
            target="_blank"
            rel="noreferrer"
          >
            官方文档
            <ExternalLink size={11} aria-hidden />
          </a>
        )}
        <span className="welcome-engine-status">
          {probe.status === "loading" && (
            <span className="welcome-pill is-loading">探针中…</span>
          )}
          {probe.status === "ok" && (
            <span className="welcome-pill">
              {probe.result?.version ?? "已安装"}
            </span>
          )}
          {probe.status === "ok" && typeof latest === "string" && outdated && (
            <span
              className="welcome-pill is-outdated"
              title={`最新版本 ${latest},点"更新"升级`}
            >
              → {latest}
            </span>
          )}
          {probe.status === "ok" && typeof latest === "string" && !outdated && (
            <span className="welcome-pill is-latest" title={`最新版本 ${latest}`}>
              已是最新
            </span>
          )}
          {probe.status === "notFound" && (
            <span className="welcome-pill is-missing">未安装</span>
          )}
          {probe.status === "error" && (
            <span className="welcome-pill is-error">探针失败</span>
          )}
        </span>
        <span className="welcome-engine-actions">
          {probe.status === "notFound" && !install.running && (
            <button
              type="button"
              className="welcome-install-btn"
              onClick={onInstall}
            >
              安装
            </button>
          )}
          {probe.status === "ok" && install.ok !== true && (
            <button
              type="button"
              className={
                outdated ? "welcome-icon-btn has-update" : "welcome-icon-btn"
              }
              onClick={onInstall}
              disabled={install.running}
              title={outdated ? `更新到 ${latest}` : "重新安装/更新到最新版"}
            >
              更新
            </button>
          )}
          <button
            type="button"
            className="welcome-icon-btn"
            onClick={onProbe}
            disabled={probe.status === "loading" || install.running}
            aria-label="重新探针"
            title="重新探针"
          >
            <RefreshCw
              size={12}
              aria-hidden
              className={probe.status === "loading" ? "is-spinning" : ""}
            />
          </button>
        </span>
      </header>

      {(install.running || install.lines.length > 0) && (
        <div className="welcome-install">
          {install.running && (
            <div className="welcome-progress" aria-label="安装中">
              <div className="welcome-progress-bar" />
            </div>
          )}
          <div className="welcome-install-log" ref={logRef}>
            {install.lines.map((line, i) => (
              <div key={i} className="welcome-install-line">
                {line}
              </div>
            ))}
          </div>
          {install.ok === true && (
            <div className="welcome-install-done is-ok">安装完成</div>
          )}
          {install.ok === false && (
            <div className="welcome-install-done is-fail">
              安装失败,日志见上方
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ── 状态钩子(供 WelcomePage 集中管理) ─────────────────── */

export function useEngineInstall(
  meta: EngineMeta,
  onDone: () => void,
): [InstallState, () => void] {
  const [state, setState] = useState<InstallState>({
    running: false,
    ok: null,
    lines: [],
  });
  const runningRef = useRef(false);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState({ running: true, ok: null, lines: [] });

    const append = (text: string) =>
      setState((prev) => ({
        ...prev,
        lines: [...prev.lines, text].slice(-LOG_LINE_LIMIT),
      }));

    const finish = (ok: boolean) => {
      runningRef.current = false;
      setState((prev) => ({ ...prev, running: false, ok }));
    };

    /* listen 是 async:unlisten 在 then 里拿;若 invoke 先完成,挂标后在
       listener 注册完成时立即退订,防竞态泄漏。 */
    let unlisten: (() => void) | null = null;
    let settled = false;
    /* 成功回调只发一次:phase 事件与 invoke 返回双双成功时不重复触发
       onDone(否则成功安装会跑两次重新探针)。 */
    let doneFired = false;
    const fireDone = () => {
      if (doneFired) return;
      doneFired = true;
      onDone();
    };
    void onCliInstallEvent(meta.binary, (e: CliInstallEvent) => {
      if (e.stream === "phase") {
        if (e.text === "done:ok") {
          finish(true);
          fireDone();
        } else if (e.text === "done:fail") finish(false);
        return;
      }
      append(e.text);
    }).then((fn) => {
      if (settled) fn();
      else unlisten = fn;
    });

    void ipc
      .cliInstallRun(meta.binary)
      .then((ok) => {
        /* phase 事件是权威收尾;invoke 返回仅兜底(事件丢失时不挂起)。 */
        setState((prev) => (prev.running ? { ...prev, running: false, ok } : prev));
        runningRef.current = false;
        if (ok) fireDone();
      })
      .catch((err) => {
        append(err instanceof Error ? err.message : String(err));
        finish(false);
      })
      .finally(() => {
        settled = true;
        unlisten?.();
      });
  }, [meta.binary, onDone]);

  return [state, start];
}

/** 单引擎探针动作(供 WelcomePage 调用)。 */
export async function probeEngine(binary: string): Promise<EngineProbeState> {
  try {
    const result = await ipc.cliProbe(binary);
    return { status: result.found ? "ok" : "notFound", result };
  } catch {
    return { status: "error", result: null };
  }
}
