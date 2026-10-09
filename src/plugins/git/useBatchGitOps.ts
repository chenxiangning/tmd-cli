/**
 * useBatchGitOps —— 聚合模式批量远端操作执行器(spec 2026-10-08-git-batch-ops-design §批量执行语义)。
 * 有界并发(BATCH_CONCURRENCY;2026-10-09 串行改并行:git CLI 每仓独立进程互不加锁,
 * GIT_TERMINAL_PROMPT=0 禁交互无叠窗,失败按行标注与顺序无关),取消 = 仓间断
 * (在途仓跑完,未起仓标「已取消」);行结果保留到下一次执行/手动刷新。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { gitErrorDisplay, isAuth } from "./gitError";
import { formatRowResult, mapPool, selectTargets, splitUpstream, BATCH_CONCURRENCY, type AggRepo, type BatchOp } from "./aggregateModel";

export type RowPhase = "queued" | "running" | "ok" | "skip" | "err";
export interface RowResult {
  phase: RowPhase;
  /** skip/err/ok 的展示文案;queued/running 为 op 标签。 */
  text: string;
}

export interface BatchRunning {
  op: BatchOp;
  done: number;
  total: number;
}

/** 批量推送选项(推送确认弹窗传入,对齐单仓 PushDialog 底栏开关;批量态不给 force-with-lease)。 */
export interface BatchPushOpts {
  followTags: boolean;
  /** 运行 Git 挂钩 = !noVerify。 */
  runHooks: boolean;
  /** 目标分支覆盖(弹窗行内编辑;缺省 = 行 upstream 拆分,无上游 = origin:<branch>)。 */
  targetByPath?: ReadonlyMap<string, { remote: string; branch: string }>;
}

export function useBatchGitOps(onSettled: () => void) {
  const [rows, setRows] = useState<ReadonlyMap<string, RowResult>>(new Map());
  const [running, setRunning] = useState<BatchRunning | null>(null);
  const cancelRef = useRef(false);
  const lastOpRef = useRef<BatchOp>("pull");
  const lastPushOptsRef = useRef<BatchPushOpts | undefined>(undefined);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  /** 核心执行链:targets 有界并发;skipped 先落行(不进队列)。 */
  const execute = useCallback(async (op: BatchOp, targets: readonly AggRepo[], prefill: ReadonlyMap<string, RowResult>, pushOpts?: BatchPushOpts) => {
    lastOpRef.current = op;
    /* 每次执行都落 opts(undefined 也落):非弹窗推送/拉取不得残留上次的分支覆盖,否则重试失败会推错目标。 */
    lastPushOptsRef.current = pushOpts;
    cancelRef.current = false;
    const opLabel = op === "fetch" ? t("获取") : op === "pull" ? t("拉取") : t("推送");
    const next = new Map(prefill);
    for (const r of targets) next.set(r.path, { phase: "queued", text: opLabel });
    setRows(next);
    setRunning({ op, done: 0, total: targets.length });

    let done = 0;
    await mapPool(targets, BATCH_CONCURRENCY, async (r) => {
      if (cancelRef.current) {
        next.set(r.path, { phase: "skip", text: t("已取消") });
      } else {
        next.set(r.path, { phase: "running", text: opLabel });
        setRows(new Map(next));
        try {
          /* 带选项推送走结构化请求(remote/branch 优先弹窗覆盖,缺省行 upstream 拆分;
             无上游缺省 origin:<branch> —— 显式 refspec 不依赖上游,gitPullPush 会报
             「no upstream」,无上游行必须走结构化)。 */
          const tgt =
            op === "push"
              ? (pushOpts?.targetByPath?.get(r.path) ??
                (r.upstream != null
                  ? splitUpstream(r.upstream)
                  : { remote: "origin", branch: r.branch }))
              : null;
          const report =
            op === "push" && tgt != null && (pushOpts != null || r.upstream == null)
              ? await ipc.gitRemoteRequest(r.path, {
                  op: "push",
                  remote: tgt.remote,
                  branch: tgt.branch,
                  strategy: null,
                  noCommit: false,
                  noVerify: pushOpts ? !pushOpts.runHooks : false,
                  forceWithLease: false,
                  followTags: pushOpts?.followTags ?? false,
                  gerrit: null,
                })
              : await ipc.gitPullPush(r.path, op);
          next.set(r.path, { phase: "ok", text: formatRowResult(op, report) });
        } catch (e) {
          next.set(r.path, {
            phase: "err",
            text: isAuth(e) ? t("凭据需要交互,请在终端执行") : gitErrorDisplay(e),
          });
        }
      }
      done += 1;
      setRows(new Map(next));
      setRunning({ op, done, total: targets.length });
    });
    setRunning(null);
    onSettledRef.current();
  }, []);

  /** 整批入口:目标选择(skip 直接落行)+ 执行;在途时忽略重复触发。 */
  const run = useCallback(
    (op: BatchOp, repos: readonly AggRepo[]) => {
      if (running) return;
      const { targets, skipped } = selectTargets(op, repos);
      const prefill = new Map<string, RowResult>();
      for (const [path, reason] of skipped) prefill.set(path, { phase: "skip", text: reason });
      void execute(op, targets, prefill);
    },
    [running, execute],
  );

  /** 推送确认弹窗入口:弹窗勾选即目标(绕过目标选择),带选项执行。 */
  const runPush = useCallback(
    (targets: readonly AggRepo[], opts: BatchPushOpts) => {
      if (running || targets.length === 0) return;
      void execute("push", targets, rows, opts);
    },
    [running, rows, execute],
  );

  /** 单仓行级操作:绕过目标选择(ahead/behind 可能是旧值,交给 git 裁决)。 */
  const runSingle = useCallback(
    (op: BatchOp, repo: AggRepo) => {
      if (running) return;
      void execute(op, [repo], rows);
    },
    [running, rows, execute],
  );

  /** 重试失败:只对 err 行重跑上次 op(推送沿用上次弹窗选项)。 */
  const retryFailed = useCallback(
    (repos: readonly AggRepo[]) => {
      if (running) return;
      const failed = repos.filter((r) => rows.get(r.path)?.phase === "err");
      if (failed.length === 0) return;
      const kept = new Map(rows);
      for (const r of failed) kept.delete(r.path);
      void execute(lastOpRef.current, failed, kept, lastPushOptsRef.current);
    },
    [running, rows, execute],
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  /** 手动刷新/离开聚合态时清行结果。 */
  const clear = useCallback(() => {
    if (!running) setRows(new Map());
  }, [running]);

  return { rows, running, run, runPush, runSingle, retryFailed, cancel, clear };
}
