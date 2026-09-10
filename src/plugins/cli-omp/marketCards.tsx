/**
 * omp 扩展面板的目录卡 —— 安装两步确认(首击展开风险详情)+ 流式日志。
 * 安装走 ipc.cliInstallRun command 通道跑 `omp plugin install/uninstall <pkg>`,
 * 日志订阅 cli-install://<installId(name)>;卡片自治全生命周期,完成后经
 * onChanged 通知面板重拉已装清单。已装行在 marketInstalledRow.tsx(共用件),
 * 装卸执行与事件流 id 在 marketInstallModel.ts(only-export-components 拆分)。
 */

import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CircleNotch, ShieldWarning } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { openExternalUrl } from "@kernel/ipc";
import type { ExtCatalogEntry } from "./catalog";
import { runPluginAction } from "./marketInstallModel";

/** 周下载量展示:1.2万 / 5.7k / 312;0 不展示。 */
function fmtDownloads(n: number): string {
  if (n >= 10_000) return t("{n}万", { n: (n / 10_000).toFixed(1) });
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 风险提示句(卡片武装展开 + 底部横幅共用文案源)。 */
function RiskNote() {
  return (
    <div className="omp-ext-risknote">
      <ShieldWarning size="0.75rem" aria-hidden />
      <span>
        {t(
          "该插件将以你的用户权限在 omp 进程内执行任意代码(tmd-cli 不做任何沙箱隔离),安装前请务必审查来源;新装插件对已开的会话不生效,需重开会话。",
        )}
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

/** 目录卡头:包名 + 版本/周下载/精选徽标(自 ExtCard 拆出降分支)。 */
function ExtCardHead({ entry }: { entry: ExtCatalogEntry }) {
  return (
    <div className="omp-ext-card-head">
      <span className="omp-ext-pkg" title={entry.name}>
        {entry.name}
      </span>
      {entry.version ? (
        <span className="omp-ext-ver">v{entry.version}</span>
      ) : null}
      {entry.weeklyDownloads > 0 ? (
        <span className="omp-ext-dl">{t("{n}/周", { n: fmtDownloads(entry.weeklyDownloads) })}</span>
      ) : null}
      {entry.curated ? <span className="omp-ext-cur">{t("精选")}</span> : null}
    </div>
  );
}

/** 目录卡脚:风险标注 + 来源链接 + 安装钮(running/已装/武装/空闲四态,自 ExtCard 拆出降分支)。 */
function ExtCardFoot({
  entry,
  running,
  installed,
  armed,
  onConfirm,
  onArm,
  onDisarm,
}: {
  entry: ExtCatalogEntry;
  running: boolean;
  installed: boolean;
  armed: boolean;
  onConfirm: () => void;
  onArm: () => void;
  onDisarm: () => void;
}) {
  return (
    <div className="omp-ext-card-foot">
      <span
        className="omp-ext-risk"
        title={t("omp 插件在你的用户权限下进程内执行任意代码")}
      >
        <ShieldWarning size="0.6875rem" aria-hidden />
        {t("任意代码执行")}
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
          <ArrowSquareOut size="0.6875rem" aria-hidden />
          {t("来源")}
        </a>
      ) : null}
      {running ? (
        <span className="omp-ext-running">
          <CircleNotch size="0.75rem" className="omp-ext-spin" aria-hidden />
          {installed ? t("卸载中") : t("安装中")}
        </span>
      ) : installed ? (
        <span className="omp-ext-done">{t("已安装")}</span>
      ) : armed ? (
        <span className="omp-ext-confirm">
          <button type="button" className="omp-ext-btn danger" onClick={onConfirm}>
            {t("确认安装")}
          </button>
          <button type="button" className="omp-ext-btn" onClick={onDisarm}>
            {t("取消")}
          </button>
        </span>
      ) : (
        <button type="button" className="omp-ext-btn" onClick={onArm}>
          {t("安装")}
        </button>
      )}
    </div>
  );
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
    try {
      const ok = await runPluginAction(entry.name, kind, push);
      push(
        ok
          ? t("—— 完成。已开会的会话不热加载,重开会话生效 ——")
          : t("—— 失败:命令非零退出,详见上方日志 ——"),
      );
    } catch (e) {
      /* cliInstallRun reject(spawn 失败/300s 超时等):不接住则 setRunning
      永不执行,卡片永久转圈(2026-09-06 win 新装机实证)。 */
      push(t("—— 失败:{error} ——", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setRunning(false);
      onChanged();
    }
  }

  return (
    <div className={`omp-ext-card${running ? " is-running" : ""}`}>
      <ExtCardHead entry={entry} />
      <div className="omp-ext-desc">{t(entry.description) || t("暂无描述")}</div>
      <ExtCardFoot
        entry={entry}
        running={running}
        installed={installed}
        armed={armed}
        onConfirm={() => run("install")}
        onArm={() => setArmed(true)}
        onDisarm={() => setArmed(false)}
      />
      {armed && !running ? <RiskNote /> : null}
      <LogArea lines={logs} />
    </div>
  );
}
