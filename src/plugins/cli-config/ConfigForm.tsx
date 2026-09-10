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
import {
  ModelMapInput,
  OrderedListInput,
  SecretInput,
} from "./FieldControls";
import { normOptions, strVal, useCatalog, withCurrent } from "./FieldControlsModel";

export function ConfigForm({
  engine,
  raw,
  onSaved,
}: {
  engine: CliConfigEntry;
  raw: string;
  onSaved: (nextRaw: string) => Promise<void>;
}) {
  const [values, setValues] = useState<CliConfigValues>(() => engine.load(raw));
  const [toast, setToast] = useState<string | null>(null);
  /* 保存成功后宿主换新 raw:重同步基线,否则 load∘save 非恒等的插件会永久假脏。 */
  useEffect(() => {
    setValues(engine.load(raw));
  }, [raw, engine]);
  const dirty = JSON.stringify(values) !== JSON.stringify(engine.load(raw));

  const set = (id: string, v: CliConfigValues[string]) =>
    setValues((prev) => ({ ...prev, [id]: v }));

  const save = async () => {
    try {
      await onSaved(engine.save(raw, values));
      setToast(t("已保存到磁盘(首次写入前已留 .bak-tmd 备份)"));
    } catch (e) {
      setToast(t("保存失败:{msg}", { msg: e instanceof Error ? e.message : String(e) }));
    }
    setTimeout(() => setToast(null), 2600);
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
      {rows(basic)}
      {advanced.length > 0 && (
        <details className="cli-cfg-advanced">
          <summary>{t("高级")}</summary>
          {rows(advanced)}
        </details>
      )}
      {dirty && (
        <div className="cli-cfg-savebar" data-testid="cli-cfg-savebar">
          <span className="cli-cfg-dirty">{t("● 未保存的更改")}</span>
          <button type="button" className="cli-cfg-btn" onClick={() => setValues(engine.load(raw))}>
            {t("放弃")}
          </button>
          <button type="button" className="cli-cfg-btn is-primary" onClick={() => void save()}>
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
                const sep = para.indexOf(":");
                const lead = sep > 0 && sep < 12 ? para.slice(0, sep) : "";
                const rest = lead ? para.slice(sep + 1) : para;
                return (
                  <p key={para}>
                    {lead && <strong>{t(lead)}:</strong>}
                    {t(rest)}
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
