/**
 * DshHostPanel —— 首页 dsh 引擎卡下方的连接面板。codemoss DshConnectionPanel
 * 同构单卡:提示行 + 主机状态区(状态点/标题/行内 origin/供应商/模型/会话数)
 * + 折叠「连接设置」,三卡合并为一卡。域逻辑(探针/持久化/会话登记)在
 * dshHost.ts;本文件管渲染与交互:
 * - 启停链路对齐 codemoss supervisor:启动 = ensure(已运行直接复用,不重
 *   spawn);停止 = 杀自spawn 会话 + 按端口停本机监听(外部拉起的 host 也能
 *   停),远程 origin 拒绝并提示。
 * - 状态决定按钮:connected → 打开 DSH Web UI/停止服务/重新检测;down →
 *   立即启动/仍尝试打开/重新检测;启动中 → 取消启动;二进制缺失 → 仅重新检测。
 * - 自动启动:进首页且 host 未运行时自动拉起(consumeAutoStart 一次性闸,
 *   拨开关不立刻启停)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  Play,
  Stop,
  X,
} from "@phosphor-icons/react";
import { openExternalUrl } from "@kernel/ipc";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { DshConnectionSettings } from "./dshConnectionSettings";
import {
  consumeAutoStart,
  delay,
  ensureHostSession,
  loadConnection,
  originOf,
  probeBinary,
  probeHost,
  saveConnection,
  stopHostSession,
  type DshConnection,
  type DshHostView,
  type RawSessionSpawner,
} from "./dshHost";
/** 经内核装配链 spawn(host.spawnRawSession):幕布输出缓冲/秒退守望全链路一致;
 *  activate:false = host 是后台基础设施,拉起不抢首页中央区。 */
const spawnHostSession: RawSessionSpawner = (profileId, spec) =>
  host.spawnRawSession(profileId, spec, undefined, { activate: false });
type HostStatus = { kind: "probing" } | { kind: "ok"; view: DshHostView } | { kind: "down" };

const BTN =
  "flex items-center gap-1 rounded-md border border-(--tmd-border) px-2.5 py-1 text-sm text-(--tmd-fg) hover:bg-(--tmd-bg-hover) disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "flex items-center gap-1 rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2.5 py-1 text-sm text-(--tmd-accent-fg) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const DOWN_ERROR = "连不上本地 host。确认 dsh web 已启动,或点立即启动。";
const REMOTE_STOP_ERROR = "只能停掉本机 DSH host。远程地址不会被关闭。";

export function DshHostPanel() {
  const [conn, setConn] = useState<DshConnection>(loadConnection);
  const [status, setStatus] = useState<HostStatus>({ kind: "probing" });
  const [binFound, setBinFound] = useState(true);
  /* 在途动作:启动中可取消;其余按钮互斥禁用。 */
  const [pending, setPending] = useState<"start" | "stop" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* 探针竞态守卫:慢探测回来时不许覆盖更新的状态。 */
  const probeSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++probeSeq.current;
    setPending("check");
    setError(null);
    const [view, found] = await Promise.all([probeHost(conn), probeBinary(conn)]);
    if (!alive.current || seq !== probeSeq.current) return;
    setBinFound(found);
    setStatus(view ? { kind: "ok", view } : { kind: "down" });
    setPending(null);
  }, [conn]);

  /* 首挂载:探一次;host 未运行且自动启动开且 dsh 在 → 自动拉起并等就绪。 */
  useEffect(() => {
    const auto = consumeAutoStart();
    void (async () => {
      const [view, found] = await Promise.all([probeHost(conn), probeBinary(conn)]);
      if (!alive.current) return;
      setBinFound(found);
      let next: DshHostView | null = view;
      if (!next && auto && conn.autoStart && found) {
        setPending("start");
        next = await ensureHostSession(conn, spawnHostSession);
      }
      /* 不做 seq 守卫:自动启动完成时写出的就是最新真相(StrictMode 双挂载下
         第二次挂载的初探会先写 down,这里随后覆盖为终态)。 */
      if (!alive.current) return;
      setStatus(next ? { kind: "ok", view: next } : { kind: "down" });
      setPending(null);
    })();
    /* 挂载级自动启动只跑一次;后续重测走 refresh。 */
  }, []);

  const applyConnection = (next: DshConnection) => {
    setConn(next);
    saveConnection(next);
    void refresh();
  };

  /* 立即启动 = codemoss ensure_host:已运行直接复用;否则拉起并等就绪。 */
  const onStart = async () => {
    setPending("start");
    setError(null);
    const view = await ensureHostSession(conn, spawnHostSession);
    if (!alive.current) return;
    setStatus(view ? { kind: "ok", view } : { kind: "down" });
    if (!view) setError(t(DOWN_ERROR));
    setPending(null);
  };

  /* 停止 = 杀自spawn 会话 + 按端口停本机监听(外部/遗留 host 也能停)。 */
  const onStop = async () => {
    setPending("stop");
    setError(null);
    const outcome = await stopHostSession(conn);
    await delay(600); // 端口释放窗口,随后重测以真实状态收口
    if (!alive.current) return;
    setPending(null);
    if (outcome === "remote") setError(t(REMOTE_STOP_ERROR));
    void refresh();
  };

  /* 取消启动:杀掉在途 spawn 的 PTY 会话,回到未运行。 */
  const onCancelStart = async () => {
    setPending("stop");
    await stopHostSession(conn);
    await delay(300);
    if (!alive.current) return;
    setPending(null);
    void refresh();
  };

  const connected = status.kind === "ok";
  const view = connected ? status.view : null;
  const title =
    pending
      ? t("正在启动…")
      : !binFound
        ? t("未安装 DSH CLI")
        : connected
          ? t("主机已连接")
          : status.kind === "down"
            ? t("主机未运行")
            : t("正在探测本地 host");
  const meta = connected
    ? null
    : !binFound
      ? t("先装本地 dsh。模型和密钥仍然去 DSH Web UI 配。")
      : status.kind === "down"
        ? t("连不上 {origin}。自动启动只影响下次对话;要现在拉起请点立即启动。", { origin: originOf(conn) })
        : t("只信 host.describe,不把端口通当作已就绪。");
  const errorText =
    error ?? (status.kind === "down" && binFound ? t(DOWN_ERROR) : null);

  const facts: Array<[string, string]> = [];
  if (view?.provider) facts.push([t("当前供应商"), view.provider]);
  if (view?.model) facts.push([t("当前模型"), view.model]);
  if (typeof view?.sessions === "number") facts.push([t("已挂会话"), String(view.sessions)]);

  return (
    <div className="mt-2">
      <div className="pref-card">
        <div className="px-4 pt-3 text-xs leading-5 text-(--tmd-fg-muted)">
          <span className="font-semibold text-(--tmd-fg)">{t("提示")}</span>{" "}
          {t("模型和 API Key 在 DSH Web UI 里配,这里只负责装 CLI、连本地 host(要求 Node ≥ 22.19 或 ≥ 24)。启动 = 新开一个「DSH Host」终端会话跑 dsh web,关掉会话即停止服务。")}
        </div>
        <div className="pref-row" aria-live="polite">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: connected
                    ? "var(--tmd-ok)"
                    : status.kind === "down"
                      ? "var(--tmd-err)"
                      : "var(--tmd-warn)",
                }}
              />
              <span className="pref-title">{title}</span>
              {connected && (
                <span className="font-mono text-xs text-(--tmd-fg-muted)">
                  {t("已连接到 {origin}", { origin: originOf(conn) })}
                </span>
              )}
            </div>
            {meta && <div className="pref-desc">{meta}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pending === "start" ? (
              <button type="button" className={BTN} onClick={() => void onCancelStart()}>
                <X size={13} /> {t("取消启动")}
              </button>
            ) : (
              <>
                {connected && (
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    onClick={() => void openExternalUrl(originOf(conn))}
                  >
                    <ArrowSquareOut size={13} /> {t("打开 DSH Web UI")}
                  </button>
                )}
                {connected && (
                  <button
                    type="button"
                    className={BTN}
                    disabled={pending !== null}
                    onClick={() => void onStop()}
                  >
                    <Stop size={13} /> {t("停止服务")}
                  </button>
                )}
                {status.kind === "down" && binFound && (
                  <>
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={pending !== null}
                      onClick={() => void onStart()}
                    >
                      <Play size={13} /> {t("立即启动")}
                    </button>
                    <button
                      type="button"
                      className={BTN}
                      onClick={() => void openExternalUrl(originOf(conn))}
                    >
                      <ArrowSquareOut size={13} /> {t("仍尝试打开")}
                    </button>
                  </>
                )}
                {binFound && (
                  <button
                    type="button"
                    className={BTN}
                    disabled={pending !== null}
                    onClick={() => void refresh()}
                  >
                    <ArrowClockwise size={13} /> {t("重新检测")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {connected && facts.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3.5 text-sm">
            {facts.map(([label, value], i) => (
              <span key={label} className="flex items-center gap-3">
                {i > 0 && <span aria-hidden className="h-3.5 w-px bg-(--tmd-border)" />}
                <span className="text-(--tmd-fg-muted)">
                  {label} <span className="font-semibold text-(--tmd-fg)">{value}</span>
                </span>
              </span>
            ))}
          </div>
        )}
        {errorText && (
          <p role="alert" className="px-4 pb-3.5 text-sm text-(--tmd-err)">
            {errorText}
          </p>
        )}
        <DshConnectionSettings conn={conn} onChange={applyConnection} />
      </div>
    </div>
  );
}
