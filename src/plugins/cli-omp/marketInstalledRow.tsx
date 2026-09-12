/**
 * omp 扩展面板的已装行 —— 行头折叠展开描述详情 + 启/停切换 + 卸载两步确认。
 * 启停走 runOmp(`omp plugin enable/disable`,proc 通道即时语义);卸载走
 * cli-install 流式通道;描述 = 目录命中优先(精选表中文),空则拉 registry 兜底。
 */

import { useEffect, useRef, useState } from "react";
import { CaretDown, CircleNotch } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { ProcRunResult } from "@kernel/ipc";
import { fetchPkgDescription, type InstalledExt } from "./catalog";
import { LogArea } from "./marketCards";
import { runPluginAction } from "./marketInstallModel";

/** 已装行卸载执行:流式日志 + 失败落行(reject 必须落失败行,否则永久转圈),收尾回调复位转圈并通知面板。 */
async function runUninstall(
  name: string,
  push: (text: string) => void,
  onSettled: () => void,
): Promise<void> {
  try {
    const ok = await runPluginAction(name, "uninstall", push);
    push(ok ? t("—— 已卸载 ——") : t("—— 失败:命令非零退出,详见上方日志 ——"));
  } catch (e) {
    /* 同 ExtCard.run:reject 必须落失败行并退出 running。 */
    push(t("—— 失败:{error} ——", { error: e instanceof Error ? e.message : String(e) }));
  } finally {
    onSettled();
  }
}

/** 行头:折叠开关 + 包名/版本/启停徽标(自 InstalledRow 拆出降分支)。 */
function InstalledRowHead({
  ext,
  open,
  onToggleOpen,
}: {
  ext: InstalledExt;
  open: boolean;
  onToggleOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="omp-ext-row-head"
      title={open ? t("收起详情") : t("展开详情")}
      onClick={onToggleOpen}
    >
      <CaretDown size="0.75rem" className="omp-ext-caret" aria-hidden />
      <span className="omp-ext-pkg" title={ext.name}>
        {ext.name}
      </span>
      <span className="omp-ext-ver">{ext.version || "?"}</span>
      <span className={`omp-ext-badge${ext.enabled ? "" : " off"}`}>
        {ext.enabled ? t("启用") : t("停用")}
      </span>
    </button>
  );
}

/** 行动作簇:启/停切换 + 卸载两步确认(自 InstalledRow 拆出降分支)。 */
function InstalledRowAction({
  ext,
  running,
  armed,
  onToggleEnabled,
  onArm,
  onDisarm,
  onConfirm,
}: {
  ext: InstalledExt;
  running: "uninstall" | "toggle" | null;
  armed: boolean;
  onToggleEnabled: () => void;
  onArm: () => void;
  onDisarm: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="omp-ext-row-action">
      {running === "toggle" ? (
        <span className="omp-ext-running">
          <CircleNotch size="0.75rem" className="omp-ext-spin" aria-hidden />
          {ext.enabled ? t("停用中") : t("启用中")}
        </span>
      ) : (
        <button
          type="button"
          className="omp-ext-btn"
          disabled={running !== null}
          onClick={onToggleEnabled}
        >
          {ext.enabled ? t("停用") : t("启用")}
        </button>
      )}
      {running === "uninstall" ? (
        <span className="omp-ext-running">
          <CircleNotch size="0.75rem" className="omp-ext-spin" aria-hidden />
          {t("卸载中")}
        </span>
      ) : armed ? (
        <span className="omp-ext-confirm">
          <button type="button" className="omp-ext-btn danger" onClick={onConfirm}>
            {t("确认卸载")}
          </button>
          <button type="button" className="omp-ext-btn" onClick={onDisarm}>
            {t("取消")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="omp-ext-btn"
          disabled={running !== null}
          onClick={onArm}
        >
          {t("卸载")}
        </button>
      )}
    </div>
  );
}

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
    await runUninstall(
      ext.name,
      (text) => setLogs((prev) => [...prev, text]),
      () => {
        setRunning(null);
        onChanged();
      },
    );
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
      <InstalledRowHead ext={ext} open={open} onToggleOpen={() => setOpen((v) => !v)} />
      <InstalledRowAction
        ext={ext}
        running={running}
        armed={armed}
        onToggleEnabled={() => toggleEnabled()}
        onArm={() => setArmed(true)}
        onDisarm={() => setArmed(false)}
        onConfirm={() => run()}
      />
      {open ? (
        <div className="omp-ext-row-detail">
          {detail === null ? t("获取描述…") : t(detail) || t("暂无描述")}
        </div>
      ) : null}
      <LogArea lines={logs} />
    </div>
  );
}
