/**
 * omp 扩展面板的目录卡 —— 安装两步确认(首击展开风险详情)+ 流式日志。
 * 安装走 ipc.cliInstallRun command 通道跑 `omp plugin install/uninstall <pkg>`,
 * 日志订阅 cli-install://<installId(name)>;卡片自治全生命周期,完成后经
 * onChanged 通知面板重拉已装清单。已装行在 marketInstalledRow.tsx(共用件)。
 */

/** 装卸事件流 id:omp-ext-<pkg 的逐字节 hex>。Tauri 事件名仅允许字母数字与
 * `- / : _`,scoped 包名的 `@` 违禁且 emit 静默失败(前端永远收不到完成事件,
 * 按钮永转);整体 hex 保证一一对应,免字符歧义。 */
export function installId(name: string): string {
  const hex = [...new TextEncoder().encode(name)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `omp-ext-${hex}`;
}

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { ipc, onCliInstallEvent, openExternalUrl } from "@kernel/ipc";
import type { ExtCatalogEntry } from "./catalog";

/** 周下载量展示:1.2万 / 5.7k / 312;0 不展示。 */
function fmtDownloads(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 风险提示句(卡片武装展开 + 底部横幅共用文案源)。 */
function RiskNote() {
  return (
    <div className="omp-ext-risknote">
      <ShieldAlert size={12} aria-hidden />
      <span>
        该插件将以你的用户权限在 omp 进程内执行任意代码(tmd-cli 不做任何
        沙箱隔离),安装前请务必审查来源;新装插件对已开的会话不生效,需重开会话。
      </span>
    </div>
  );
}

/** 流式日志区:等宽逐行,自动滚底(目录卡与已装行共用)。 */
export function LogArea({ lines }: { lines: string[] }) {
  const boxRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length]);
  if (lines.length === 0) return null;
  return (
    <pre className="omp-ext-log" ref={boxRef}>
      {lines.join("\n")}
    </pre>
  );
}

/** 卡片/已装行共用的装卸执行:流式日志 + 完成/失败落一行,返回是否成功。 */
export async function runPluginAction(
  name: string,
  kind: "install" | "uninstall",
  onLine: (text: string) => void,
): Promise<boolean> {
  /* 先订阅再发命令:tauri listen 异步注册,悬空退订会漏卸订或漏早期日志。 */
  const unlisten = await onCliInstallEvent(installId(name), (e) => onLine(e.text));
  try {
    const ok = await ipc.cliInstallRun(installId(name), {
      channel: "command",
      program: "omp",
      args:
        kind === "install"
          ? ["plugin", "install", name]
          : ["plugin", "uninstall", name],
    });
    return ok;
  } finally {
    unlisten();
  }
}

/** 目录卡:安装 = 两步确认(首击展开风险详情,无回弹);已装置灰。 */
export function ExtCard({
  entry,
  installed,
  onChanged,
}: {
  entry: ExtCatalogEntry;
  installed: boolean;
  onChanged: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [armed, setArmed] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  async function run(kind: "install" | "uninstall") {
    setArmed(false);
    setRunning(true);
    setLogs([]);
    const push = (text: string) => setLogs((prev) => [...prev, text]);
    const ok = await runPluginAction(entry.name, kind, push);
    push(
      ok
        ? "—— 完成。已开会的会话不热加载,重开会话生效 ——"
        : "—— 失败:命令非零退出,详见上方日志 ——",
    );
    setRunning(false);
    onChanged();
  }

  return (
    <div className={`omp-ext-card${running ? " is-running" : ""}`}>
      <div className="omp-ext-card-head">
        <span className="omp-ext-pkg" title={entry.name}>
          {entry.name}
        </span>
        {entry.version ? (
          <span className="omp-ext-ver">v{entry.version}</span>
        ) : null}
        {entry.weeklyDownloads > 0 ? (
          <span className="omp-ext-dl">{fmtDownloads(entry.weeklyDownloads)}/周</span>
        ) : null}
        {entry.curated ? <span className="omp-ext-cur">精选</span> : null}
      </div>
      <div className="omp-ext-desc">{entry.description || "暂无描述"}</div>
      <div className="omp-ext-card-foot">
        <span
          className="omp-ext-risk"
          title="omp 插件在你的用户权限下进程内执行任意代码"
        >
          <ShieldAlert size={11} aria-hidden />
          任意代码执行
        </span>
        {entry.homepage ? (
          <a
            className="omp-ext-link"
            href={entry.homepage}
            onClick={(e) => {
              /* webview 内 target=_blank 不开系统浏览器,走 shell open。 */
              e.preventDefault();
              if (entry.homepage) void openExternalUrl(entry.homepage);
            }}
          >
            <ExternalLink size={11} aria-hidden />
            来源
          </a>
        ) : null}
        {running ? (
          <span className="omp-ext-running">
            <Loader2 size={12} className="omp-ext-spin" aria-hidden />
            {installed ? "卸载中" : "安装中"}
          </span>
        ) : installed ? (
          <span className="omp-ext-done">已安装</span>
        ) : armed ? (
          <span className="omp-ext-confirm">
            <button type="button" className="omp-ext-btn danger" onClick={() => run("install")}>
              确认安装
            </button>
            <button type="button" className="omp-ext-btn" onClick={() => setArmed(false)}>
              取消
            </button>
          </span>
        ) : (
          <button type="button" className="omp-ext-btn" onClick={() => setArmed(true)}>
            安装
          </button>
        )}
      </div>
      {armed && !running ? <RiskNote /> : null}
      <LogArea lines={logs} />
    </div>
  );
}
