/**
 * 供应商认证 · 设置/编辑 Key 对话框(password 输入;提交 trim 后由 providerAuth 校验写入)。
 */

import { useState } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogShell, DialogActions } from "@kernel/DialogShell";

export function KeyDialog({
  name,
  saving,
  onClose,
  onSubmit,
}: {
  name: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (key: string) => void;
}) {
  const [key, setKey] = useState("");
  return (
    <DialogShell
      title={t("设置 Key — {name}", { name })}
      icon={<PlusIcon className="size-4" weight="fill" aria-hidden />}
      locked={saving}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("保存")}
          confirmDisabled={!key.trim()}
          submitting={saving}
          onConfirm={() => onSubmit(key)}
          onCancel={onClose}
        />
      }
    >
      <div className="mt-3 flex flex-col gap-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-muted)">{t("API Key")}</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1.5 font-mono text-xs"
            data-testid="provider-auth-key-input"
          />
        </label>
      </div>
    </DialogShell>
  );
}
