/**
 * 插排页「本地插件」分区 UI:清单 / 状态徽章 / 信任确认 / 版本历史与回退 / 删除(废纸篓)/ 重扫 / 开发提示词。
 * 数据源 = kernel/localPlugins 记录表(useLocalPluginRecords);本组件只做展示与动作转发。
 */
import { useState } from "react";
import { ArrowCounterClockwise, Copy, Trash } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import {
  confirmLocalPlugin,
  isContentTrusted,
  rescanLocalPlugins,
  rollbackLocalPlugin,
  useLocalPluginRecords,
  type LocalPluginRecord,
} from "@kernel/localPlugins";
import { updateSettings, useSettingsState } from "@kernel/settings";

function hash8(hash: string | null): string {
  return hash ? hash.slice(0, 8) : "—";
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function StatusBadge({ rec }: { rec: LocalPluginRecord }) {
  if (rec.error)
    return <span className="lp-badge lp-badge-err">{t("加载失败")}:{rec.error}</span>;
  if (rec.activateError)
    return <span className="lp-badge lp-badge-err">{rec.activateError}</span>;
  if (rec.removed) return <span className="lp-badge">{t("已移除 · 重启后卸载")}</span>;
  if (!rec.contentHash) return <span className="lp-badge">{t("目录异常")}</span>;
  if (rec.activatedHash === rec.contentHash)
    return <span className="lp-badge lp-badge-on">{t("运行中")}</span>;
  /* 内容已变:已信任 → 重启生效;未信任 → 待启用(要点一次确认) */
  if (rec.activatedHash && rec.activatedHash !== rec.contentHash)
    return isContentTrusted(rec.id, rec.contentHash) ? (
      <span className="lp-badge lp-badge-warn">{t("已更新 · 重启生效")}</span>
    ) : (
      <span className="lp-badge lp-badge-warn">{t("已更新 · 待启用")}</span>
    );
  return <span className="lp-badge lp-badge-warn">{t("待启用")}</span>;
}

function Row({
  rec,
  busy,
  onBusy,
}: {
  rec: LocalPluginRecord;
  busy: boolean;
  onBusy: (p: Promise<void>) => void;
}) {
  const [showVersions, setShowVersions] = useState(false);
  const version = String(rec.manifest?.version ?? "0.0.0");
  const permissions = Array.isArray(rec.manifest?.permissions)
    ? (rec.manifest?.permissions as string[]).join(" / ")
    : "";
  /* 确认按钮只在「有新内容且未信任且未移除」时出现;已信任的新内容属重启生效,无需按钮 */
  const needsConfirm =
    !rec.error && !rec.removed && !!rec.contentHash && !isContentTrusted(rec.id, rec.contentHash)
      ? rec.activatedHash !== rec.contentHash || !rec.activatedHash
      : false;
  /* 按内容 hash 去重,保留首次归档(版本号段最可信);老版回退不对齐 manifest 时期产生的
     「0.2.0-<0.1.0hash>」错位条目不再显示(Rust 归档层已同步按内容去重防新增)。 */
  const seen = new Set<string>();
  const versions = [...rec.versions]
    .sort((a, b) => a.modified_ms - b.modified_ms)
    .filter((v) => {
      const key = v.sha256.slice(0, 8);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.modified_ms - a.modified_ms);

  const del = () => {
    if (!window.confirm(t("把插件 {id} 移入系统废纸篓?(重启后卸载,可从废纸篓找回)", { id: rec.id })))
      return;
    onBusy(
      (async () => {
        await ipc.pluginDelete(rec.id);
        await rescanLocalPlugins();
      })(),
    );
  };

  return (
    <div className="lp-row">
      <div className="lp-row-main">
        <span className="lp-name">
          {rec.meta?.name ?? rec.id}
          <span className="lp-ver">
            {t("v{v} · 本地", { v: version })} · {hash8(rec.contentHash)}
          </span>
        </span>
        <StatusBadge rec={rec} />
        {permissions && <span className="lp-perms">{t("权限")}: {permissions}</span>}
      </div>
      <div className="lp-actions">
        {needsConfirm && !rec.removed && (
          <button
            type="button"
            className="lp-btn lp-btn-primary"
            disabled={busy}
            onClick={() => onBusy(confirmLocalPlugin(rec.id))}
          >
            {rec.activatedHash ? t("确认更新") : t("启用")}
          </button>
        )}
        {rec.versions.length > 0 && (
          <button
            type="button"
            className="lp-btn"
            disabled={busy}
            onClick={() => setShowVersions((v) => !v)}
          >
            {t("版本历史")}({versions.length})
          </button>
        )}
        <button type="button" className="lp-btn" disabled={busy} title={t("移入废纸篓")} onClick={del}>
          <Trash size="0.75rem" aria-hidden />
        </button>
      </div>
      {showVersions && (
        <div className="lp-versions">
          {versions.map((v) => (
            <div key={v.name} className="lp-version-row">
              <span className="lp-version-meta">
                {v.name.replace(/\.js$/, "")} · {fmtTime(v.modified_ms)}
              </span>
              <button
                type="button"
                className="lp-btn"
                disabled={busy}
                onClick={() => onBusy(rollbackLocalPlugin(rec.id, v.name))}
              >
                <ArrowCounterClockwise size="0.75rem" aria-hidden />
                {t("回退到此版")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LocalPluginsSection() {
  const records = useLocalPluginRecords();
  const { settings } = useSettingsState();
  const [busy, setBusy] = useState<Promise<void> | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /* 动作失败统一落一行错误文案(回退/删除/剪贴板),不再静默吞 */
  const wrap = (p: Promise<void>) => {
    setBusy(p);
    setActionError(null);
    p.catch((e) => setActionError(e instanceof Error ? e.message : String(e))).finally(() =>
      setBusy(null),
    );
  };

  const copyPrompt = () => {
    void import("./devPrompt")
      .then(({ DEV_PROMPT }) => navigator.clipboard.writeText(DEV_PROMPT))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setActionError(t("剪贴板写入失败")));
  };

  const toggleAll = () =>
    updateSettings({ localPluginsDisabled: !settings.localPluginsDisabled });

  return (
    <div className="lp-section">
      <div className="lp-head">
        <span className="lp-title">{t("本地插件")}</span>
        <span className="lp-sub">
          {settings.localPluginsDisabled
            ? t("已禁用全部本地插件(插件文件保留,随时可再开)")
            : t("放在 ~/.tmd-cli/plugins/ 的插件,免重启装载")}
        </span>
        <div className="lp-head-actions">
          <button type="button" className="lp-btn" onClick={copyPrompt}>
            <Copy size="0.75rem" aria-hidden />
            {copied ? t("已复制") : t("复制插件开发提示词")}
          </button>
          <button
            type="button"
            className="lp-btn"
            disabled={busy !== null}
            onClick={() => wrap(rescanLocalPlugins())}
          >
            {t("重新扫描")}
          </button>
          <button type="button" className="lp-btn" onClick={toggleAll}>
            {settings.localPluginsDisabled ? t("启用全部本地插件") : t("禁用全部本地插件")}
          </button>
        </div>
      </div>
      {actionError && (
        <div className="lp-action-err">
          {t("操作失败")}: {actionError}
        </div>
      )}
      {settings.localPluginsDisabled ? (
        <div className="lp-empty">{t("本地插件已全部禁用 —— 插件文件与版本库原样保留")}</div>
      ) : records.length === 0 ? (
        <div className="lp-empty">
          {t("还没有本地插件 —— 点「复制插件开发提示词」,在任意会话里粘贴给 AI,让它把插件写进 ~/.tmd-cli/plugins/ 即可")}
        </div>
      ) : (
        records.map((rec) => <Row key={rec.id} rec={rec} busy={busy !== null} onBusy={wrap} />)
      )}
    </div>
  );
}
