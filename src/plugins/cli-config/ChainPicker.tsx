/**
 * 有序模型链(回退链):值 = 逗号分隔的 "provider/model[:suffix]" 序列,
 * 每项 = 三级选择器 + 上移/下移/删除;空串项保留为可配置空行,落盘由 save 端过滤。
 */
import { CaretDown, CaretUp, Plus, Trash } from "@phosphor-icons/react";
import type { CliModelCatalogProvider } from "@kernel/cliConfigRegistry";
import { t } from "@kernel/i18n";
import { ModelPicker } from "./ModelPicker";
import { rowKey } from "./FieldControlsModel";

export function ChainPicker({
  value,
  catalog,
  suffixes,
  onChange,
}: {
  value: string;
  catalog: CliModelCatalogProvider[] | null;
  suffixes?: string[];
  onChange: (v: string) => void;
}) {
  const items = value.split(",").map((s) => s.trim());
  const seen = new Map<string, number>();
  const commit = (next: string[]) => onChange(next.join(","));
  const patch = (i: number, item: string) => commit(items.map((x, j) => (j === i ? item : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  return (
    <div className="cli-cfg-kv cli-cfg-chain">
      {items.map((item, i) => (
        <div key={rowKey(item, seen)} className="cli-cfg-kv-row">
          <ModelPicker value={item} catalog={catalog} suffixes={suffixes} onChange={(v) => patch(i, v)} />
          <span className="cli-cfg-chain-ctl">
            <button type="button" className="cli-cfg-icon-btn" aria-label={t("上移")} disabled={i === 0}
              onClick={() => move(i, -1)}>
              <CaretUp size={12} />
            </button>
            <button type="button" className="cli-cfg-icon-btn" aria-label={t("下移")} disabled={i === items.length - 1}
              onClick={() => move(i, 1)}>
              <CaretDown size={12} />
            </button>
            <button type="button" className="cli-cfg-icon-btn" aria-label={t("删除")}
              onClick={() => commit(items.filter((_, j) => j !== i).filter(Boolean))}>
              <Trash size={13} />
            </button>
          </span>
        </div>
      ))}
      <button type="button" className="cli-cfg-add" onClick={() => commit([...items, ""])}>
        <Plus size={12} /> {t("添加候选")}
      </button>
    </div>
  );
}
