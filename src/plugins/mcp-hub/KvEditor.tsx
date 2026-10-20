/**
 * env/headers 键值行编辑器 —— 从 ServerEditModal.tsx 拆出的展示组件
 * (2026-10-20 守 300 行铁则;零语义改动)。值列走 SecretInput 默认掩码
 * (密钥脱敏纪律),行 id 仅作 React key。
 */
import { t } from "@kernel/i18n";
import { SecretInput } from "@kernel/SecretInput";
import { newRow, type KvRow } from "./serverEditDraft";

export function KvEditor({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-1.5">
          <input
            className="mcphub-input w-36 flex-none"
            value={row.k}
            aria-label={`${label} KEY`}
            onChange={(e) => onChange(rows.map((r) => (r.id === row.id ? { ...r, k: e.target.value } : r)))}
          />
          <div className="min-w-0 flex-1">
            <SecretInput
              id={`mcphub-kv-${row.id}`}
              value={row.v}
              onChange={(v) => onChange(rows.map((r) => (r.id === row.id ? { ...r, v } : r)))}
            />
          </div>
          <button
            type="button"
            className="mcphub-icon-btn hover:text-(--tmd-diff-removed)"
            title={t("移除此行")}
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="mcphub-ghost-btn self-start" onClick={() => onChange([...rows, newRow()])}>
        {t("加一行 {label}", { label })}
      </button>
    </div>
  );
}
