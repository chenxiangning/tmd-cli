/**
 * ConfigFile —— 单份配置文件的读取/编辑/落盘壳(GUI 表单或 raw 编辑器)。
 * 自 CliConfigTab 拆出(文件规模铁则):脏态信号经 onDirtyChange 上报宿主,
 * 供切换引擎/配置源/模式前的「丢弃修改」确认。读取三态与 persist 语义不变:
 * ok 进编辑;missing 按空文件可首次创建;error(存在但不可读)阻断编辑防覆写。
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { retryImport } from "@kernel/lazyImport";
/* codemirror core 懒出桌面首屏静态图(FileTabContent/RemoteFileTab 同款先例)。 */
const FileCodeEditor = lazy(retryImport(() =>
  import("@kernel/cmEditor/FileCodeEditor").then((m) => ({ default: m.FileCodeEditor })),
));
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { CliConfigEntry, CliConfigSource } from "@kernel/cliConfigRegistry";
import { readConfig, writeConfigFile } from "./io";
import { ConfigForm } from "./ConfigForm";

function BlockingError({ title, message, path }: { title: string; message: string; path: string }) {
  return (
    <div className="cli-cfg-error" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <button
        type="button"
        className="cli-cfg-link"
        onClick={() => void ipc.fsRevealInFileManager(path)}
      >
        {t("在文件管理器中显示")}
      </button>
    </div>
  );
}

export function ConfigFile({
  engine,
  source,
  mode,
  dark,
  onDirtyChange,
}: {
  engine: CliConfigEntry;
  source: CliConfigSource;
  mode: "gui" | "raw";
  dark: boolean;
  /** 脏态上报:GUI 模式转发 ConfigForm 的对比;raw 模式本层对比 draft/raw。 */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [draft, setDraft] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    setDraft(null);
    setLoadError(null);
    setReadError(null);
    void readConfig(source.path).then((r) => {
      if (cancelled) return;
      if (r.kind === "error") {
        setReadError(r.message);
        return;
      }
      const content = r.kind === "ok" ? r.text : "";
      setRaw(content);
      setDraft(content);
      /* 空文件同样过一遍 load 校验:ConfigForm 的 useState 初始化会再调 load,
         不先验证会让插件抛错直接崩掉整个 section。 */
      try {
        /* 基线同时定格(values 空间 JSON):GUI 脏判定用,宿主持有避免子件 effect。 */
        setBaseline(JSON.stringify(engine.load(content)));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [engine, source.path]);

  /* 卸载复位:切引擎/源/模式整树重建时清掉旧脏态,阻断态不给下一次切换误弹确认
     (mount 期信号在事件点维护,见 markDraft/persist,不走 effect 上报)。 */
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  /* raw 草稿事件时信号:onChange/放弃/保存三个事件点同步上报,加载中/阻断态不报。 */
  const markDraft = (v: string) => {
    setDraft(v);
    onDirtyChange(raw !== null && v !== raw);
  };

  if (raw === null) return <p className="cli-cfg-empty">{t("读取配置…")}</p>;

  const persist = async (next: string) => {
    setSaving(true);
    try {
      await writeConfigFile(source.path, next);
      setRaw(next);
      setDraft(next);
      /* 保存成功重同步基线(load∘save 非恒等的插件不永久假脏)。 */
      try {
        setBaseline(JSON.stringify(engine.load(next)));
      } catch {
        /* 插件读不回自己的保存产物属插件缺陷:保旧基线,脏判定保守偏严。 */
      }
      onDirtyChange(false);
      setWriteError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setWriteError(msg);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  if (readError) {
    return (
      <BlockingError title={t("无法读取配置文件")} message={readError} path={source.path} />
    );
  }

  if (loadError) {
    return (
      <BlockingError title={t("无法解析配置文件")} message={loadError} path={source.path} />
    );
  }

  if (mode === "raw" && engine.rawEditor) {
    const dirty = draft !== raw;
    return (
      <div className="cli-cfg-raw">
        <Suspense
          fallback={<div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">{t("加载中…")}</div>}
        >
          <FileCodeEditor
            path={source.path}
            value={draft ?? raw}
            dark={dark}
            onChange={markDraft}
            onSave={() => void persist(draft ?? raw).catch(() => undefined)}
          />
        </Suspense>
        {writeError && (
          <div className="cli-cfg-error" role="alert">
            <p>{writeError}</p>
          </div>
        )}
        {dirty && (
          <div className="cli-cfg-savebar" data-testid="cli-cfg-savebar">
            <span className="cli-cfg-dirty">{t("● 未保存的更改")}</span>
            <button type="button" className="cli-cfg-btn" onClick={() => markDraft(raw)}>
              {t("放弃")}
            </button>
            <button
              type="button"
              className="cli-cfg-btn is-primary"
              disabled={saving}
              onClick={() => void persist(draft ?? raw).catch(() => undefined)}
            >
              {t("保存到磁盘")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return <ConfigForm engine={engine} raw={raw} baseline={baseline} onSaved={persist} onDirtyChange={onDirtyChange} />;
}
