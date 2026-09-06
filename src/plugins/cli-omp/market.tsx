/**
 * omp 扩展市场面板 —— cli-omp 二级插件管理(装卸 omp 自己的 npm 扩展)。
 * 设计:docs/superpowers/specs/2026-09-06-omp-extension-market-design.md
 *
 * 数据面(语义全在本目录 catalog.ts / marketCards.tsx):
 * - 本机探测:ipc.cliProbe("omp")(版本 + 在位);缺失 → 引导欢迎页引擎卡
 * - 已装清单:`omp plugin list --json`(proc 通道,15s 超时;closeStdin 防
 *   一次性 CLI 等 EOF 挂死)
 * - 热门目录:npm registry 双关键词,静态精选兜底(20s 缓存)
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, Cross } from "@phosphor-icons/react";
import { ipc, type CliProbeResult } from "@kernel/ipc";
import {
  fetchExtCatalog,
  parseOmpPluginList,
  type ExtCatalog,
  type InstalledExt,
} from "./catalog";
import { ExtCard } from "./marketCards";
import { InstalledRow } from "./marketInstalledRow";

export function OmpExtensionMarket({ onClose }: { onClose: () => void }) {
  const [probe, setProbe] = useState<CliProbeResult | null>(null);
  const [installed, setInstalled] = useState<InstalledExt[] | null>(null);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ExtCatalog | null>(null);

  /** omp 短命令执行(enable/disable 等即时语义;configHomeDir 供 CLI 发现工程锚)。 */
  const runOmp = useCallback(async (args: string[]) => {
    const home = await ipc.configHomeDir();
    return ipc.procCommunicate({
      command: "omp",
      args,
      cwd: home,
      closeStdin: true,
      timeoutMs: 15_000,
    });
  }, []);

  /** 重拉已装清单(装卸/启停完成后由行回调)。 */
  const refreshInstalled = useCallback(() => {
    void (async () => {
      try {
        const res = await runOmp(["plugin", "list", "--json"]);
        setInstalled(parseOmpPluginList(JSON.parse(res.stdout)));
        setInstalledError(null);
      } catch (err) {
        setInstalled(null);
        setInstalledError(String(err));
      }
    })();
  }, [runOmp]);

  useEffect(() => {
    void ipc
      .cliProbe("omp")
      .then(setProbe)
      .catch(() => setProbe(null));
    refreshInstalled();
    void fetchExtCatalog().then(setCatalog);
  }, [refreshInstalled]);

  /** 头部刷新:目录强刷 + 已装重拉。 */
  const refresh = useCallback(() => {
    refreshInstalled();
    void fetchExtCatalog(true).then(setCatalog);
  }, [refreshInstalled]);

  /* 已装描述解析:目录命中(精选表为中文,实时表为 npm 原文)优先;未命中
     空串,行展开时自行拉 registry 兜底。 */
  const descByName = new Map(
    (catalog?.entries ?? []).map((e) => [e.name, e.description]),
  );
  const installedNames = new Set((installed ?? []).map((i) => i.name));

  return (
    <div className="omp-ext">
      <header className="omp-ext-head">
        <span className="omp-ext-title">omp 扩展</span>
        {probe?.found && probe.version ? (
          <span className="omp-ext-cli">
            omp {probe.version.replace(/^omp\//, "")}
          </span>
        ) : null}
        <span className="omp-ext-head-space" />
        <button
          type="button"
          className="omp-ext-iconbtn"
          title="刷新"
          onClick={refresh}
        >
          <ArrowClockwise size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="omp-ext-iconbtn"
          title="关闭"
          onClick={onClose}
        >
          <Cross size={14} aria-hidden />
        </button>
      </header>

      {!probe ? (
        <div className="omp-ext-state">检测 omp…</div>
      ) : !probe.found ? (
        <div className="omp-ext-state">
          未检测到 omp CLI —— 到「欢迎页」引擎卡先安装 omp,再回来管理扩展
        </div>
      ) : (
        <>
          <div className="omp-ext-body">
            {catalog?.offline ? (
              <div className="omp-ext-offline">
                实时目录拉取失败,展示离线精选目录
              </div>
            ) : null}

            <div className="omp-ext-section">
              已安装({installed?.length ?? "…"})
            </div>
            {installedError ? (
              <div className="omp-ext-state">
                无法解析已装清单:{installedError}
              </div>
            ) : installed === null ? (
              <div className="omp-ext-state">读取已装清单…</div>
            ) : installed.length === 0 ? (
              <div className="omp-ext-state">还没有安装任何扩展</div>
            ) : (
              installed.map((ext) => (
                <InstalledRow
                  key={ext.name}
                  ext={ext}
                  description={descByName.get(ext.name) ?? ""}
                  runOmp={runOmp}
                  onChanged={refreshInstalled}
                />
              ))
            )}

            <div className="omp-ext-section">
              热门扩展{catalog?.offline ? "(离线精选)" : ""}
            </div>
            {catalog === null ? (
              <div className="omp-ext-state">加载目录…</div>
            ) : (
              catalog.entries.map((entry) => (
                <ExtCard
                  key={entry.name}
                  entry={entry}
                  installed={installedNames.has(entry.name)}
                  onChanged={refreshInstalled}
                />
              ))
            )}
          </div>

          <footer className="omp-ext-foot">
            扩展以当前用户权限在 omp 进程内执行任意代码;装卸/启停即时改磁盘,
            已开的 omp 会话不热加载,重开会话生效。
          </footer>
        </>
      )}
    </div>
  );
}
