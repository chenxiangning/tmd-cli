/**
 * 基础设置 / 打开方式 tab —— 外部应用清单管理(复刻 mossx OpenAppsSection)。
 * 行 = 图标 + 名称 + 副行 + 可用徽标(懒探测,不轮询)+ 默认星标 + 上/下移 + 删除;
 * 「添加打开方式」= 预设网格(未安装/已添加灰显)+ 浏览…(系统对话框选 .app/可执行)。
 * 写 kernel/settings 即写即生效(updateSettings,无保存按钮,惯例同行为页);
 * 删默认项时 openWithDefaultId 回落剩余首项(与消费侧 resolveDefaultOpenWith 语义一致)。
 */

import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretUp, Plus, Star, Trash } from "@phosphor-icons/react";
import { ipc, pickOpenWithApp } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import {
  OPEN_WITH_PRESET_CATALOG,
  customOpenWithTarget,
  detectOpenWithPlatform,
  openWithSubtitle,
  openWithTargetFromPreset,
} from "@kernel/openWith";
import { OpenWithIcon } from "@kernel/OpenWithIcon";
import type { OpenWithTarget } from "@kernel/settingsTypes";

/** 宿主平台可见预设(模块级一次;UA 会话内不变)。 */
const PLATFORM_PRESETS = OPEN_WITH_PRESET_CATALOG.filter((p) =>
  p.platforms.includes(detectOpenWithPlatform()),
);

/** 清单行:挂载即探一次可用性;target 变化(重命名/换应用)重探。 */
function OpenWithRow({
  target,
  isDefault,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onSetDefault,
}: {
  target: OpenWithTarget;
  isDefault: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  const [probe, setProbe] = useState<boolean | null>(null);
  useEffect(() => {
    if (target.kind === "finder") {
      setProbe(true);
      return;
    }
    let alive = true;
    ipc.fsProbeOpenApp(target)
      .then((r) => {
        if (alive) setProbe(r.ok);
      })
      .catch(() => {
        if (alive) setProbe(false);
      });
    return () => {
      alive = false;
    };
  }, [target]);

  return (
    <div className="ow-row" data-testid="openwith-row">
      <OpenWithIcon target={target} size="1.375rem" />
      <div className="ow-row-main">
        <span className="ow-row-title">{target.label}</span>
        <span className="ow-row-sub">{openWithSubtitle(target)}</span>
      </div>
      <span
        className={`ow-badge${probe === null ? "" : probe ? " is-ok" : " is-miss"}`}
        aria-label={t("可用性")}
      >
        {probe === null ? "…" : probe ? t("可用") : t("未装")}
      </span>
      <button
        type="button"
        className={`ow-row-act${isDefault ? " is-default" : ""}`}
        onClick={() => onSetDefault(target.id)}
        aria-pressed={isDefault}
        title={t("默认")}
      >
        <Star size="0.75rem" weight={isDefault ? "fill" : "regular"} />
        {t("默认")}
      </button>
      <button type="button" className="ow-row-act" disabled={isFirst} onClick={() => onMove(target.id, -1)} title={t("上移")}>
        <CaretUp size="0.875rem" />
      </button>
      <button type="button" className="ow-row-act" disabled={isLast} onClick={() => onMove(target.id, 1)} title={t("下移")}>
        <CaretDown size="0.875rem" />
      </button>
      <button type="button" className="ow-row-act" onClick={() => onRemove(target.id)} title={t("删除")}>
        <Trash size="0.875rem" />
      </button>
    </div>
  );
}

/** 添加对话框:预设网格(未安装/已添加灰显)+ 浏览系统对话框;原生 dialog(Esc/背板关)。 */
function AddOpenWithDialog({
  existing,
  onAdd,
  onClose,
}: {
  existing: Set<string>;
  onAdd: (target: OpenWithTarget) => void;
  onClose: () => void;
}) {
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const dlgRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    let alive = true;
    for (const preset of PLATFORM_PRESETS) {
      if (preset.kind === "finder") {
        setInstalled((m) => ({ ...m, [preset.id]: true }));
        continue;
      }
      ipc.fsProbeOpenApp(openWithTargetFromPreset(preset))
        .then((r) => {
          if (alive) setInstalled((m) => ({ ...m, [preset.id]: r.ok }));
        })
        .catch(() => {
          if (alive) setInstalled((m) => ({ ...m, [preset.id]: false }));
        });
    }
    return () => {
      alive = false;
    };
  }, []);

  /* showModal:顶层渲染 + 原生 Esc(onCancel);背板点击(target 即 dialog 本身)收口。
     背板命中挂在 ref 上 —— 原生 dialog 惯例,JSX onClick 会被 no-noninteractive 规则误标 */
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    dlg.showModal();
    const onPointerDown = (e: MouseEvent) => {
      if (e.target === dlg) onClose();
    };
    dlg.addEventListener("click", onPointerDown);
    return () => dlg.removeEventListener("click", onPointerDown);
  }, [onClose]);

  const browse = async () => {
    const path = await pickOpenWithApp();
    if (!path) return;
    onAdd(customOpenWithTarget(path));
    onClose();
  };

  return (
    <dialog
      ref={dlgRef}
      className="owdlg"
      aria-label={t("添加打开方式")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="owdlg-title">{t("添加打开方式")}</div>
      <div className="owdlg-grid">
        {PLATFORM_PRESETS.map((preset) => {
          const added = existing.has(preset.id);
          const missing = installed[preset.id] === false;
          return (
            <button
              key={preset.id}
              type="button"
              className="owdlg-preset"
              disabled={added || missing}
              title={added ? t("已添加") : missing ? t("未安装") : undefined}
              onClick={() => {
                onAdd(openWithTargetFromPreset(preset));
                onClose();
              }}
            >
              <OpenWithIcon target={openWithTargetFromPreset(preset)} size="1.125rem" />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="owdlg-browse" onClick={() => void browse()}>
        {t("浏览…(选择 .app 或可执行文件)")}
      </button>
    </dialog>
  );
}

export function OpenWithTab() {
  const { settings } = useSettingsState();
  const targets = settings.openWithTargets;
  const [adding, setAdding] = useState(false);

  const move = (id: string, dir: -1 | 1) => {
    const i = targets.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= targets.length) return;
    const next = [...targets];
    [next[i], next[j]] = [next[j], next[i]];
    updateSettings({ openWithTargets: next });
  };

  const remove = (id: string) => {
    const next = targets.filter((x) => x.id !== id);
    if (settings.openWithDefaultId === id) {
      updateSettings({ openWithTargets: next, openWithDefaultId: next[0]?.id ?? "" });
    } else {
      updateSettings({ openWithTargets: next });
    }
  };

  const add = (target: OpenWithTarget) => {
    if (targets.some((x) => x.id === target.id)) return;
    updateSettings({ openWithTargets: [...targets, target] });
  };

  return (
    <div className="pref-card" data-testid="settings-openwith-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("打开方式")}</div>
          <div className="pref-desc">
            {t("自定义文件底部「打开方式」菜单的应用清单。命令接收选定路径作为最终参数;应用通过系统启动器打开(macOS 为 open,Windows/Linux 为可执行文件或 PATH 命令)。")}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {targets.map((target, i) => (
          <OpenWithRow
            key={target.id}
            target={target}
            isDefault={target.id === settings.openWithDefaultId}
            isFirst={i === 0}
            isLast={i === targets.length - 1}
            onMove={move}
            onRemove={remove}
            onSetDefault={(id) => updateSettings({ openWithDefaultId: id })}
          />
        ))}
      </div>
      <button
        type="button"
        className="owdlg-browse"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, alignSelf: "center", padding: "6px 14px" }}
        onClick={() => setAdding(true)}
      >
        <Plus size="0.875rem" />
        {t("添加打开方式")}
      </button>
      {adding && (
        <AddOpenWithDialog
          existing={new Set(targets.map((x) => x.id))}
          onAdd={add}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
