/**
 * 渠道添加/编辑对话框 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 复用 kernel DialogShell(通用弹层骨架)与 SecretInput,避免重新发明 dialog 容器。
 * 归属:cli-shared/providerChannels(消费 = cli-config/claude/codex 三家)。
 */

import { useEffect, useRef, useState } from "react";
import { CloudIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogShell, DialogActions } from "@kernel/DialogShell";
import { SecretInput } from "@kernel/SecretInput";
import type { Channel } from "./types";

export interface ChannelFormValue {
  name: string;
  remark?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export function ChannelDialog({
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  /** 编辑:传入已有;添加:null。 */
  initial: Channel | null;
  submitting: boolean;
  onSubmit: (v: ChannelFormValue) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [remark, setRemark] = useState(initial?.remark ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [model, setModel] = useState(initial?.model ?? "");

  const trimmedName = name.trim();
  const valid = trimmedName.length > 0;
  const nameRef = useRef<HTMLInputElement>(null);
  /* 挂载即聚焦名称框(库先例,替代被禁的 autoFocus)。 */
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <DialogShell
      title={initial ? t("编辑渠道") : t("添加渠道")}
      icon={<CloudIcon className="size-4" weight="fill" aria-hidden />}
      locked={submitting}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={initial ? t("保存") : t("添加")}
          confirmDisabled={!valid}
          submitting={submitting}
          onConfirm={() =>
            onSubmit({
              name: trimmedName,
              remark: remark.trim() || undefined,
              baseUrl: baseUrl.trim() || undefined,
              apiKey: apiKey.trim() || undefined,
              model: model.trim() || undefined,
            })
          }
          onCancel={onClose}
        />
      }
    >
      <div className="mt-3 flex flex-col gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-muted)">{t("名称")}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            ref={nameRef}
            className="rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1.5 text-xs"
            data-testid="channel-dialog-name"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-muted)">{t("说明(可选)")}</span>
          <input
            type="text"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            className="rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1.5 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-muted)">{t("API 地址")}</span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://…"
            className="rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1.5 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-muted)">{t("API Key")}</span>
          <SecretInput id="channel-apikey" value={apiKey} onChange={setApiKey} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-muted)">{t("模型(可选)")}</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1.5 text-xs"
          />
        </label>
      </div>
    </DialogShell>
  );
}
