/**
 * ports · 扫描生命周期 hook —— 扫描状态持有/手动刷新/自动轮询/NEW 标 diff,
 * 工作区名表(仓库认领显示名)随首扫一并装载。纯编排无 UI;
 * PortsView 只留交互状态(过滤/折叠/kill/复制闪态)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@kernel/ipc";
import { scanPorts } from "./portsScan";
import { rowKey } from "./portsTree";
import type { ScanOutcome } from "./types";

const AUTO_KEY = "tmd.ports.auto";
const AUTO_MS = 5000;

/**
 * 刷新互斥闸:同一时刻只跑一个扫描;busy 期间到达的请求不丢,
 * 折叠为 busy 归零后的一次补跑(kill 后的重扫不被在途扫描的 busy 闸吞掉)。
 * 折叠语义 = 后到覆盖:只补跑最后一个请求的 job。
 */
export function createRefreshGate() {
  let running = false;
  let pending: (() => Promise<void>) | null = null;
  return {
    get busy() {
      return running;
    },
    async run(job: () => Promise<void>): Promise<void> {
      if (running) {
        pending = job;
        return;
      }
      running = true;
      try {
        await job();
      } finally {
        running = false;
        const next = pending;
        pending = null;
        if (next) await next();
      }
    },
  };
}

export interface PortsScanState {
  outcome: ScanOutcome | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  /** 上一轮扫描有命令超时截断(结果可能不完整);开扫即清,成功后按结果置位。 */
  timedOut: boolean;
  setNotice: (msg: string | null) => void;
  auto: boolean;
  toggleAuto: () => void;
  newKeys: ReadonlySet<string>;
  wsNames: Map<string, string>;
  refresh: () => Promise<void>;
}

export function usePortsScan(): PortsScanState {
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) === "1");
  const [newKeys, setNewKeys] = useState<ReadonlySet<string>>(new Set());
  const [wsNames, setWsNames] = useState<Map<string, string>>(new Map());
  const [gate] = useState(createRefreshGate);
  const prevKeysRef = useRef<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    await gate.run(async () => {
      setLoading(true);
      setTimedOut(false);
      try {
        const next = await scanPorts();
        const keys = new Set(next.rows.map(rowKey));
        if (prevKeysRef.current.size > 0) {
          setNewKeys(new Set([...keys].filter((k) => !prevKeysRef.current.has(k))));
        }
        prevKeysRef.current = keys;
        setOutcome(next);
        setError(null);
        setTimedOut(next.timedOut);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    });
  }, [gate]);

  /* 首扫 + 工作区名表装载;失败静默(认领仅少显示名,不阻塞列表)。 */
  useEffect(() => {
    void refresh();
    ipc
      .configReadWorkspaces()
      .then((file) => setWsNames(new Map((file.list ?? []).map((w) => [w.root.replace(/\/+$/, ""), w.name]))))
      .catch(() => {});
  }, [refresh]);

  /* 手动开启的 5s 前台轮询:失焦跳过、扫描中跳过、tab 卸载即停。 */
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !gate.busy) void refresh();
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [auto, refresh, gate]);

  const toggleAuto = () => {
    const next = !auto;
    localStorage.setItem(AUTO_KEY, next ? "1" : "0");
    setAuto(next);
  };

  return { outcome, loading, error, notice, timedOut, setNotice, auto, toggleAuto, newKeys, wsNames, refresh };
}
