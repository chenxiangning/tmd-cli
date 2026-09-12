/**
 * 供应商渠道列表卡(图2-3)—— 归属 cli-shared(providerChannels;消费 =
 * cli-config/claude/codex 三家,满足 1 cli + feature 与 ≥2 cli 双准入),
 * row click 切换(apply 成功才回写 current),
 * Switch 同步;current 行删除禁用。归属 cli-config(本页 UI 所有者),
 * 格式/存储走 @plugins/cli-shared/providerChannels。spec: 2026-09-11-cli-provider-channels-design.md。
 */
import { useCallback, useEffect, useState } from "react";
import { DownloadSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { genChannelId, loadChannelDoc, removeChannel, saveChannelDoc, setCurrent, upsertChannel } from "./store";
import { dedupeCcSwitchImport, normalizeProvider, probeCcSwitch, readCcSwitchV2, readCcSwitchV3 } from "./ccswitch";
import type { Channel, ChannelDoc, SupportedEngineId } from "./types";
import { ipc } from "@kernel/ipc";
import { ChannelDialog, type ChannelFormValue } from "./ChannelDialog";
import { ChannelRow } from "./ChannelRow";

export interface ProviderChannelsCardProps {
  engineId: SupportedEngineId;
  /** 把 channel 写进 CLI 原生配置;抛错 = UI 显示 banner 且 store 不动。 */
  applyChannel: (channel: Channel) => Promise<void>;
}

export function ProviderChannelsCard({ engineId, applyChannel }: ProviderChannelsCardProps) {
  const [doc, setDoc] = useState<ChannelDoc | null>(null);
  const [editing, setEditing] = useState<Channel | null | undefined>(undefined); // undefined=关, null=新增, Channel=编辑
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Channel | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadChannelDoc()
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const eng = doc?.engines[engineId];
  const providers = eng ? Object.values(eng.providers).sort((a, b) => a.createdAt - b.createdAt) : [];
  const currentId = eng?.current ?? null;

  const closeDialog = useCallback(() => setEditing(undefined), []);

  const handleSubmit = useCallback(
    async (v: ChannelFormValue) => {
      if (!doc) return;
      const dup = Object.values(doc.engines[engineId]?.providers ?? {}).some(
        (p) => p.name === v.name && p.id !== editing?.id,
      );
      if (dup) {
        setError(t("同名渠道已存在:{name}", { name: v.name }));
        return;
      }
      setSubmitting(true);
      try {
        const ch: Channel = {
          id: editing?.id ?? genChannelId(),
          name: v.name,
          remark: v.remark,
          baseUrl: v.baseUrl,
          apiKey: v.apiKey,
          model: v.model,
          source: editing?.source,
          ccsId: editing?.ccsId,
          createdAt: editing?.createdAt ?? Date.now(),
        };
        const next = upsertChannel(doc, engineId, ch);
        await saveChannelDoc(next);
        setDoc(next);
        setEditing(undefined);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitting(false);
      }
    },
    [doc, editing, engineId],
  );

  const handleActivate = useCallback(
    async (ch: Channel) => {
      if (!doc || ch.id === currentId) return;
      setBusy(true);
      setError(null);
      try {
        await applyChannel(ch);
        const next = setCurrent(doc, engineId, ch.id);
        await saveChannelDoc(next);
        setDoc(next);
        setNotice(t("已切换:{name}", { name: ch.name }));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [applyChannel, currentId, doc, engineId],
  );

  const handleDelete = useCallback(
    async (ch: Channel) => {
      if (!doc) return;
      if (ch.id === currentId) return; // 禁用,沿 codemoss 纪律
      setBusy(true);
      try {
        const next = removeChannel(doc, engineId, ch.id);
        await saveChannelDoc(next);
        setDoc(next);
        setConfirmDelete(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [currentId, doc, engineId],
  );

  const handleImport = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const kind = await probeCcSwitch();
      if (kind === "none") {
        setError(t("未检测到 cc-switch 数据(本机没有 ~/.cc-switch/)"));
        return;
      }
      const home = await ipc.configHomeDir();
      const byEngine =
        kind === "v3-db"
          ? await readCcSwitchV3(home)
          : await readCcSwitchV2(home);
      const incoming: Channel[] = [];
      for (const [eng, list] of byEngine.entries()) {
        if (eng !== engineId) continue; // 当前 tab 只导入对应引擎
        for (const r of list) incoming.push(normalizeProvider(eng, r));
      }
      if (!incoming.length) {
        setNotice(t("cc-switch 没有 {engine} 的渠道", { engine: engineId }));
        return;
      }
      const existingByCcsId = new Map<string, Channel>();
      for (const c of Object.values(doc?.engines[engineId]?.providers ?? {})) {
        if (c.ccsId) existingByCcsId.set(c.ccsId, c);
      }
      const { updated, added, skipped } = dedupeCcSwitchImport(existingByCcsId, incoming);
      if (!doc) return;
      let next = doc;
      for (const ch of updated) next = upsertChannel(next, engineId, ch);
      for (const ch of added) next = upsertChannel(next, engineId, ch);
      await saveChannelDoc(next);
      setDoc(next);
      setNotice(
        t("已导入 cc-switch:新增 {added},更新 {updated},跳过 {skipped}", {
          added: added.length,
          updated: updated.length,
          skipped: skipped.length,
        }),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [doc, engineId]);

  if (error && !doc) {
    return (
      <div className="provider-panel mt-4" data-testid="provider-panel">
        <div className="cli-cfg-error" role="alert">
          <p>{error}</p>
          <button type="button" className="cli-cfg-link" onClick={() => setError(null)}>
            {t("关闭")}
          </button>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <p className="provider-panel cli-cfg-empty mt-4" data-testid="provider-panel">
        {t("读取渠道…")}
      </p>
    );
  }

  return (
    <section className="provider-panel mt-6" data-testid="provider-panel" data-engine={engineId}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold text-(--tmd-fg)">{t("供应商渠道")}</h3>
          <p className="text-xs text-(--tmd-fg-muted)">
            {t("点击行即切换 · 对新会话生效")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cli-cfg-btn"
            onClick={() => void handleImport()}
            disabled={busy}
            data-testid="provider-import-ccswitch"
          >
            <DownloadSimpleIcon className="size-3.5" weight="bold" aria-hidden />
            {t("导入 ccswitch")}
          </button>
          <button
            type="button"
            className="cli-cfg-btn is-primary"
            onClick={() => setEditing(null)}
            disabled={busy}
            data-testid="provider-add"
          >
            <PlusIcon className="size-3.5" weight="bold" aria-hidden />
            {t("添加渠道")}
          </button>
        </div>
      </header>

      {error && (
        <div className="cli-cfg-error mt-3" role="alert" data-testid="provider-error">
          <p>{error}</p>
          <button type="button" className="cli-cfg-link" onClick={() => setError(null)}>
            {t("关闭")}
          </button>
        </div>
      )}
      {notice && !error && (
        <div className="mt-3 text-xs text-(--tmd-fg-muted)" data-testid="provider-notice">
          {notice}
        </div>
      )}

      {providers.length === 0 ? (
        <div
          className="mt-3 rounded-lg border border-dashed border-(--tmd-border) bg-(--tmd-bg-card) py-10 text-center text-xs text-(--tmd-fg-muted)"
          data-testid="provider-empty"
        >
          <p className="text-(--tmd-fg)">{t("还没有自定义渠道")}</p>
          <p className="mt-1">{t("点击右上角「添加渠道」创建")}</p>
        </div>
      ) : (
        <div
          className="mt-3 divide-y divide-(--tmd-border) overflow-hidden rounded-lg border border-(--tmd-border) bg-(--tmd-bg-card)"
          data-testid="provider-list"
        >
          {providers.map((ch) => (
            <ChannelRow
              key={ch.id}
              channel={ch}
              isCurrent={ch.id === currentId}
              busy={busy}
              isConfirmingDelete={confirmDelete?.id === ch.id}
              onActivate={() => { if (!busy && ch.id !== currentId) void handleActivate(ch); }}
              onEdit={() => setEditing(ch)}
              onRequestDelete={() => setConfirmDelete(ch)}
              onConfirmDelete={() => void handleDelete(ch)}
              onCancelDelete={() => setConfirmDelete(null)}
            />
          ))}
        </div>
      )}

      {editing !== undefined && (
        <ChannelDialog
          initial={editing}
          submitting={submitting}
          onSubmit={(v) => void handleSubmit(v)}
          onClose={closeDialog}
        />
      )}
    </section>
  );
}

