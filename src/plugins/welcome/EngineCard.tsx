/**
 * 单引擎卡片 —— 探针状态 + 一键安装(indeterminate 进度条 + 流式日志)。
 *
 * 数据流:
 * - mount → ipc.cliProbe(binary) 探一次;安装完成后自动重探;
 * - 安装:订阅 cli-install://{engine} 事件流 → 日志追加(上限 200 行滚动);
 *   phase "done:ok" → 重探 + 收尾;"done:fail" → 红字收尾,日志保留可翻。
 * - 前置依赖(profile.requires,如 omp → bun):依赖未就位时主引擎的
 *   安装/更新按钮禁用,卡片内引导先装依赖(独立安装日志);依赖探针 ok 后恢复。
 */
import { useCallback, useRef, useState } from "react";
import { XCircle, ArrowSquareOut, ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import {
  ipc,
  onCliInstallEvent,
  type CliInstallEvent,
  type CliInstallPlan,
  type CliProbeResult,
} from "@kernel/ipc";
import type { CliProfile } from "@kernel/cli";
import type { EngineMeta } from "./engineMeta";
import { isOutdated } from "./latestVersion";
import { InstallLog } from "./InstallLog";
import { PrerequisiteGuide } from "./PrerequisiteGuide";

/** 日志滚动上限(行)。npm 全量输出数千行,只留尾部。 */
const LOG_LINE_LIMIT = 200;

type ProbeStatus = "loading" | "ok" | "notFound" | "error";

export interface EngineProbeState {
  status: ProbeStatus;
  result: CliProbeResult | null;
}

export interface InstallState {
  running: boolean;
  ok: boolean | null;
  lines: string[];
}

/** 可安装目标 —— EngineMeta 与 PrerequisiteMeta 的共有形状,安装钩子复用同一套。 */
export interface InstallTarget {
  /** binary 名;安装事件 topic 的 id 惯例 = cli-install://{binary}。 */
  binary: string;
  /** 参数化安装计划;null = 未声明安装通道(start 直接 no-op)。 */
  plan: CliInstallPlan | null;
}

export function EngineCard({
  meta,
  profile,
  probe,
  latest,
  install,
  onProbe,
  onInstall,
  depProbe,
  depInstall,
  onDepInstall,
  onDepProbe,
}: {
  meta: EngineMeta;
  profile: CliProfile | undefined;
  probe: EngineProbeState;
  /** 最新版本:undefined=查询中,null=查询失败(不渲染),string=已拿到。 */
  latest: string | null | undefined;
  install: InstallState;
  onProbe: () => void;
  onInstall: () => void;
  /** 依赖探针状态;缺省 = 按探针中处理(保守禁用安装按钮)。 */
  depProbe?: EngineProbeState;
  /** 依赖自身的安装状态与动作(引导区按钮/日志)。 */
  depInstall: InstallState;
  onDepInstall: () => void;
  onDepProbe: () => void;
}) {
  const outdated = isOutdated(probe.result?.version, latest ?? null);
  /* 依赖门控:声明了依赖且未就位(探针中/未装/探针失败)→ 安装/更新不可点。 */
  const depBlocked = !!meta.requires && (!depProbe || depProbe.status !== "ok");
  const depName = meta.requires?.name ?? "";

  return (
    <section className="welcome-engine-card">
      <header className="welcome-engine-head">
        <span className="welcome-engine-icon" aria-hidden>
          {profile?.renderIcon ? profile.renderIcon("1.375rem") : <XCircle size="1.375rem" />}
        </span>
        <span className="welcome-engine-name">{t(meta.displayName)}</span>
        {meta.docsUrl && (
          <a
            className="welcome-engine-docs"
            href={meta.docsUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t("官方文档")}
            <ArrowSquareOut size="0.6875rem" aria-hidden />
          </a>
        )}
        <span className="welcome-engine-status">
          {probe.status === "loading" && (
            <span className="welcome-pill is-loading">{t("探针中…")}</span>
          )}
          {probe.status === "ok" && (
            <span className="welcome-pill">
              {probe.result?.version ?? t("已安装")}
            </span>
          )}
          {probe.status === "ok" && typeof latest === "string" && outdated && (
            <span
              className="welcome-pill is-outdated"
              title={t('最新版本 {version},点"更新"升级', { version: latest })}
            >
              → {latest}
            </span>
          )}
          {probe.status === "ok" && typeof latest === "string" && !outdated && (
            <span className="welcome-pill is-latest" title={t("最新版本 {version}", { version: latest })}>
              {t("已是最新")}
            </span>
          )}
          {probe.status === "notFound" && (
            <span className="welcome-pill is-missing">{t("未安装")}</span>
          )}
          {probe.status === "error" && (
            <span className="welcome-pill is-error">{t("探针失败")}</span>
          )}
        </span>
        <span className="welcome-engine-actions">
          {probe.status === "notFound" && !install.running && meta.plan && (
            <button
              type="button"
              className="welcome-install-btn"
              onClick={onInstall}
              disabled={depBlocked}
              title={depBlocked ? t("先安装 {name}", { name: depName }) : undefined}
            >
              {t("安装")}
            </button>
          )}
          {probe.status === "ok" && install.ok !== true && meta.plan && (
            <button
              type="button"
              className={
                outdated ? "welcome-icon-btn has-update" : "welcome-icon-btn"
              }
              onClick={onInstall}
              disabled={install.running || depBlocked}
              title={
                depBlocked
                  ? t("先安装 {name}", { name: depName })
                  : outdated
                    ? t("更新到 {version}", { version: latest })
                    : t("重新安装/更新到最新版")
              }
            >
              {t("更新")}
            </button>
          )}
          <button
            type="button"
            className="welcome-icon-btn"
            onClick={onProbe}
            disabled={probe.status === "loading" || install.running}
            aria-label={t("重新探针")}
            title={t("重新探针")}
          >
            <ArrowClockwise
              size="0.75rem"
              aria-hidden
              className={probe.status === "loading" ? "is-spinning" : ""}
            />
          </button>
        </span>
      </header>

      {/* 前置依赖引导:未就位时引导先装依赖(独立安装日志);探针 ok 后整块消失。 */}
      {meta.requires && depProbe && depProbe.status !== "ok" && (
        <PrerequisiteGuide
          requires={meta.requires}
          probe={depProbe}
          install={depInstall}
          onInstall={onDepInstall}
          onProbe={onDepProbe}
        />
      )}

      {(install.running || install.lines.length > 0) && (
        <InstallLog install={install} label={t("安装")} />
      )}
    </section>
  );
}

/* ── 状态钩子(供 WelcomePage 集中管理) ─────────────────── */

export function useEngineInstall(
  target: InstallTarget | null,
  onDone: () => void,
): [InstallState, () => void] {
  const [state, setState] = useState<InstallState>({
    running: false,
    ok: null,
    lines: [],
  });
  const runningRef = useRef(false);

  const start = useCallback(() => {
    if (!target || !target.plan || runningRef.current) return;
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
    void onCliInstallEvent(target.binary, (e: CliInstallEvent) => {
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
      .cliInstallRun(target.binary, target.plan)
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
  }, [target?.binary, target?.plan, onDone]);

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
