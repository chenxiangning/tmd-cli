/**
 * 通用配置表单 —— 按 CliConfigEntry.fields 渲染引擎贡献的 schema。
 *
 * 值形态:标量 = string|boolean;modelMap = [键, 值][];orderedList = string[]。
 * 保存 = engine.save(raw, values) 交回插件纯函数(行级补丁/合并),宿主不碰格式;
 * onSaved 回传写盘 Promise —— 失败必须可见(吞掉就是假「已保存」)。
 */

import { useEffect, useRef, useState } from "react";
import type {
  CliConfigEntry,
  CliConfigField,
  CliConfigValues,
  CliModelCatalogProvider,
  CliSelectOption,
} from "@kernel/cliConfigRegistry";
import { StyledSelect } from "@kernel/StyledSelect";
import { t } from "@kernel/i18n";
import { ModelPicker } from "./ModelPicker";
import { ModelMapInput, OrderedListInput } from "./FieldControls";
import { SecretInput } from "@kernel/SecretInput";
import { normOptions, strVal, useCatalog, withCurrent } from "./FieldControlsModel";
import { useConfigSave } from "./useConfigSave";

export function ConfigForm({
  engine,
  raw,
  baseline,
  onSaved,
  onDirtyChange,
}: {
  engine: CliConfigEntry;
  raw: string;
  /** 脏判定基线(values 空间的 JSON;宿主持有,读取完成与保存成功后更新)。 */
  baseline: string;
  onSaved: (nextRaw: string) => Promise<void>;
  /** 脏态上报:宿主据此在切换引擎/配置源/模式前弹「丢弃修改」确认。 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [values, setValues] = useState<CliConfigValues>(() => engine.load(raw));
  /* 脏态走事件时信号;保存成功直接对齐规范化值,不能再对比旧 baseline 闭包。 */
  const [dirty, setDirty] = useState(false);
  const { saving, toast, saveError, clearSaveError, save: persist } = useConfigSave(
    onSaved,
    (nextRaw) => {
      const savedValues = engine.load(nextRaw);
      setValues(savedValues);
      setDirty(false);
      onDirtyChange?.(false);
    },
  );
  const markDirty = (next: CliConfigValues) => {
    const d = JSON.stringify(next) !== baseline;
    setDirty(d);
    onDirtyChange?.(d);
  };

  const set = (id: string, v: CliConfigValues[string]) => {
    const next = { ...values, [id]: v };
    setValues(next);
    markDirty(next);
  };

  const save = () => void persist(engine.save(raw, values));

  const discard = () => {
    const restored = engine.load(raw);
    setValues(restored);
    markDirty(restored);
  };

  const rows = (fields: CliConfigField[]) =>
    fields.map((f) => (
      <FieldRow
        key={f.id}
        field={f}
        values={values}
        onSet={(v) => set(f.id, v)}
      />
    ));

  const basic = engine.fields.filter((f) => !f.advanced);
  const advanced = engine.fields.filter((f) => f.advanced);

  return (
    <div className="cli-cfg-form">
      <fieldset className="contents" disabled={saving} aria-busy={saving}>
        {rows(basic)}
        {advanced.length > 0 && (
          <details className="cli-cfg-advanced">
            <summary>{t("高级")}</summary>
            {rows(advanced)}
          </details>
        )}
      </fieldset>
      {saveError && (
        <div className="cli-cfg-error" role="alert" data-testid="cli-cfg-save-error">
          <p>{saveError}</p>
          <button type="button" className="cli-cfg-link" onClick={clearSaveError}>
            {t("关闭错误提示")}
          </button>
        </div>
      )}
      {dirty && (
        <div className="cli-cfg-savebar" data-testid="cli-cfg-savebar">
          <span className="cli-cfg-dirty">{t("● 未保存的更改")}</span>
          <button type="button" className="cli-cfg-btn" disabled={saving} onClick={discard}>
            {t("放弃")}
          </button>
          <button type="button" className="cli-cfg-btn is-primary" disabled={saving} onClick={save}>
            {t("保存到磁盘")}
          </button>
        </div>
      )}
      {toast && (
        <div className="cli-cfg-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** 单行:标题 + 磁盘键提示 + 控件;options 支持同步/函数/异步三种。 */
function FieldRow({
  field,
  values,
  onSet,
}: {
  field: CliConfigField;
  values: CliConfigValues;
  onSet: (v: CliConfigValues[string]) => void;
}) {
  const value = values[field.id];
  const options = useFieldOptions(field, values);
  const catalog = useCatalog(field);

  return (
    <div className="cli-cfg-row">
      <div className="cli-cfg-row-text">
        <div className="cli-cfg-row-title">{t(field.label)}</div>
        {field.detail && (
          <details className="cli-cfg-detail">
            <summary>{t("说明")}</summary>
            <div className="cli-cfg-detail-body">
              {field.detail.split("\n").map((para) => {
                /* 整段查键(词典键 = 定义处完整中文段),译文再按首个短冒号
                   拆 lead 加粗 —— 片段级查键需 40 条拆分键,反模式已废弃 */
                const zh = para;
                const sep = zh.indexOf(":");
                const hasLead = sep > 0 && sep < 12;
                const translated = t(zh);
                const tSep = hasLead
                  ? translated.indexOf(":")
                  : -1; /* 译文冒号位置可能漂移,找不到就不加粗 */
                const lead = tSep > 0 && tSep < 24 ? translated.slice(0, tSep) : "";
                const rest = lead ? translated.slice(tSep + 1) : translated;
                return (
                  <p key={para}>
                    {lead && <strong>{lead}:</strong>}
                    {rest}
                  </p>
                );
              })}
            </div>
          </details>
        )}
      </div>
      <FieldControl field={field} value={value} options={options} catalog={catalog} values={values} onSet={onSet} />
    </div>
  );
}

function useFieldOptions(
  field: CliConfigField,
  values: CliConfigValues,
): CliSelectOption[] {
  const [asyncOpts, setAsyncOpts] = useState<CliSelectOption[] | null>(null);
  const mountValues = useRef(values);
  useEffect(() => {
    if (typeof field.options !== "function") return;
    const resolved = field.options(mountValues.current);
    if (!(resolved instanceof Promise)) return;
    let cancelled = false;
    void resolved.then((o) => {
      if (!cancelled) setAsyncOpts(o);
    });
    return () => {
      cancelled = true;
    };
  }, [field]);
  if (typeof field.options === "function") {
    const resolved = field.options(values);
    const arr = resolved instanceof Promise ? (asyncOpts ?? []) : resolved;
    return arr.map((o) => (typeof o === "string" ? { value: o } : o));
  }
  return (field.options ?? []).map((o) => (typeof o === "string" ? { value: o } : o));
}

function FieldControl({
  field,
  value,
  options,
  catalog,
  values,
  onSet,
}: {
  field: CliConfigField;
  value: CliConfigValues[string] | undefined;
  options: CliSelectOption[];
  catalog: CliModelCatalogProvider[] | null;
  values: CliConfigValues;
  onSet: (v: CliConfigValues[string]) => void;
}) {
  const s = strVal(value);
  switch (field.kind) {
    case "toggle":
      return (
        <button
          type="button"
          role="switch"
          aria-label={t(field.label)}
          aria-checked={value === true}
          className={`cli-cfg-switch${value === true ? " is-on" : ""}`}
          onClick={() => onSet(value !== true)}
        >
          <span className="cli-cfg-knob" />
        </button>
      );
    case "secret":
      return <SecretInput id={field.id} value={s} onChange={onSet} />;
    case "modelMap":
      return (
        <ModelMapInput
          field={field}
          value={Array.isArray(value) ? (value as Array<[string, string]>) : []}
          onSet={onSet}
          values={values}
        />
      );
    case "orderedList":
      return (
        <OrderedListInput
          field={field}
          value={Array.isArray(value) ? (value as string[]) : []}
          onSet={onSet}
        />
      );
    case "select":
      if (field.catalog) {
        return (
          <ModelPicker
            value={s}
            catalog={catalog}
            onChange={onSet}
          />
        );
      }
      return (
        <StyledSelect
          value={s}
          options={normOptions(withCurrent(options, s))}
          onChange={onSet}
        />
      );
    default:
      return (
        <input
          className="cli-cfg-input"
          value={s}
          placeholder={strVal(typeof options[0] === "string" ? options[0] : options[0]?.value ?? "")}
          onChange={(e) => onSet(e.target.value)}
        />
      );
  }
}
