/**
 * 设置面板通用行组件(wallpaper 插件内)—— 分段行(可选色点)与滑杆行。
 * 样式全复用 pref-card/pref-row/segmented 现有类,零新增设置 CSS。
 */

export type SegValue = string | number | boolean;
export type Option<T extends SegValue> = {
  value: T;
  label: string;
  disabled?: boolean;
  /** 预设色点(流体 preset):按钮文案前的圆点。 */
  swatch?: string;
};

export function SegmentedPrefRow<T extends SegValue>({
  title,
  desc,
  value,
  options,
  onSelect,
}: {
  title: string;
  desc?: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="pref-row">
      <div>
        <div className="pref-title">{title}</div>
        {desc ? <div className="pref-desc">{desc}</div> : null}
      </div>
      <div className="segmented" role="radiogroup" aria-label={title}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segment${value === option.value ? " is-active" : ""}`}
            disabled={option.disabled}
            onClick={() => onSelect(option.value)}
          >
            {option.swatch ? (
              <span
                className="wp-fluid-swatch"
                style={{ backgroundColor: option.swatch }}
                aria-hidden
              />
            ) : null}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SliderPrefRow({
  title,
  desc,
  ariaLabel,
  min,
  max,
  value,
  unit,
  onChange,
}: {
  title: string;
  desc?: string;
  ariaLabel: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="pref-row">
      <div>
        <div className="pref-title">{title}</div>
        {desc ? <div className="pref-desc">{desc}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={ariaLabel}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-28 accent-(--tmd-accent)"
        />
        <span className="w-9 text-right text-sm tabular-nums text-(--tmd-fg-muted)">
          {value}
          {unit}
        </span>
      </div>
    </div>
  );
}
