/**
 * omp 扩展面板的已装行 —— 行头折叠展开描述详情 + 启/停切换 + 卸载两步确认。
 * 启停走 runOmp(`omp plugin enable/disable`,proc 通道即时语义);卸载走
 * cli-install 流式通道;描述 = 目录命中优先(精选表中文),空则拉 registry 兜底。
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import type { ProcRunResult } from "@kernel/ipc";
import { fetchPkgDescription, type InstalledExt } from "./catalog";
import { LogArea, runPluginAction } from "./marketCards";

export function InstalledRow({
  ext,
  description,
  runOmp,
  onChanged,
}: {
  ext: InstalledExt;
  /** 目录/精选表解析出的描述;空串 = 目录外,展开时拉 registry 兜底。 */
  description: string;
  /** omp 短命令执行(enable/disable 即时语义,非安装流)。 */
  runOmp: (args: string[]) => Promise<ProcRunResult>;
  onChanged: () => void;
}) {
  const [running, setRunning] = useState<"uninstall" | "toggle" | null>(null);
  const [armed, setArmed] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(description || null);
  const timerRef = useRef<number | null>(null);

  /* 目录侧描述更新(目录刷新后重拉)跟随。 */
  useEffect(() => {
    if (description) setDetail(description);
  }, [description]);

  /* 武装 3s 回弹:废纸篓先例同款;running 期间不计时。 */
  useEffect(() => {
    if (!armed || running) return undefined;
    timerRef.current = window.setTimeout(() => setArmed(false), 3000);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [armed, running]);

  /* 展开且无描述(目录外)→ registry 单包兜底。 */
  useEffect(() => {
    if (!open || detail !== null) return undefined;
    let alive = true;
    void fetchPkgDescription(ext.name).then((desc) => {
      if (alive) setDetail(desc);
    });
    return () => {
      alive = false;
    };
  }, [open, detail, ext.name]);

  async function run() {
    setArmed(false);
    setRunning("uninstall");
    setLogs([]);
    const push = (text: string) => setLogs((prev) => [...prev, text]);
    try {
      const ok = await runPluginAction(ext.name, "uninstall", push);
      push(ok ? "—— 已卸载 ——" : "—— 失败:命令非零退出,详见上方日志 ——");
    } catch (e) {
      /* 同 ExtCard.run:reject 必须落失败行并退出 running,否则永久转圈。 */
      push(`—— 失败:${e instanceof Error ? e.message : String(e)} ——`);
    } finally {
      setRunning(null);
      onChanged();
    }
  }

  async function toggleEnabled() {
    setRunning("toggle");
    try {
      await runOmp(["plugin", ext.enabled ? "disable" : "enable", ext.name]);
    } finally {
      setRunning(null);
      onChanged();
    }
  }

  return (
    <div className={`omp-ext-row${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="omp-ext-row-head"
        title={open ? "收起详情" : "展开详情"}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={12} className="omp-ext-caret" aria-hidden />
        <span className="omp-ext-pkg" title={ext.name}>
          {ext.name}
        </span>
        <span className="omp-ext-ver">{ext.version || "?"}</span>
        <span className={`omp-ext-badge${ext.enabled ? "" : " off"}`}>
          {ext.enabled ? "启用" : "停用"}
        </span>
      </button>
      <div className="omp-ext-row-action">
        {running === "toggle" ? (
          <span className="omp-ext-running">
            <Loader2 size={12} className="omp-ext-spin" aria-hidden />
            {ext.enabled ? "停用中" : "启用中"}
          </span>
        ) : (
          <button
            type="button"
            className="omp-ext-btn"
            disabled={running !== null}
            onClick={toggleEnabled}
          >
            {ext.enabled ? "停用" : "启用"}
          </button>
        )}
        {running === "uninstall" ? (
          <span className="omp-ext-running">
            <Loader2 size={12} className="omp-ext-spin" aria-hidden />
            卸载中
          </span>
        ) : armed ? (
          <span className="omp-ext-confirm">
            <button type="button" className="omp-ext-btn danger" onClick={run}>
              确认卸载
            </button>
            <button type="button" className="omp-ext-btn" onClick={() => setArmed(false)}>
              取消
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="omp-ext-btn"
            disabled={running !== null}
            onClick={() => setArmed(true)}
          >
            卸载
          </button>
        )}
      </div>
      {open ? (
        <div className="omp-ext-row-detail">
          {detail === null ? "获取描述…" : detail || "暂无描述"}
        </div>
      ) : null}
      <LogArea lines={logs} />
    </div>
  );
}
