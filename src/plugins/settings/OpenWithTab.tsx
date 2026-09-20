/**
 * 基础设置「打开方式」tab(settings 插件)—— 复刻 mossx OpenAppsSection basic-redesign 形态:
 * 分割线行列表(24 图标容器 + 13.5/600 标题 + 12 副行)+ 健康徽标(可点重探)+
 * 默认胶囊(非默认行显示设默认星钮)+ 28px 幽灵动作钮(上移/下移/删除)+
 * 圆角添加钮开行列表式选择器(预设行 + 浏览自定义;未装/已加禁用)。
 */

import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretUp, Plus, Star, Trash } from "@phosphor-icons/react";
import { ipc, pickOpenWithApp, type OpenWithProbe } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { getSettingsState, updateSettings, useSettingsState } from "@kernel/settings";
import { OPEN_WITH_TARGETS_MAX } from "@kernel/settingsSanitizeOpenWith";
import {
  OPEN_WITH_PRESET_CATALOG,
  customOpenWithTarget,
  detectOpenWithPlatform,
  openWithSubtitle,
  openWithTargetFromPreset,
} from "@kernel/openWith";
import { OpenWithIcon } from "@kernel/OpenWithIcon";
import type { OpenWithTarget } from "@kernel/settingsTypes";
type Health = "ok" | "miss";

/** 探测一批目标/预设,合并进现有表(键 = appName|command;finder 恒可用不探测)。 */
async function probeAll(
  items: readonly { kind: OpenWithTarget["kind"]; appName?: string; command?: string }[],
  prev: Record<string, Health>,
): Promise<Record<string, Health>> {
  const next = { ...prev };
  await Promise.all(
    items.map(async (item) => {
      if (item.kind === "finder") return;
      const key = item.kind === "app" ? (item.appName ?? "") : (item.command ?? "");
      if (key === "" || next[key] !== undefined) return;
      try {
        const r: OpenWithProbe = await ipc.fsProbeOpenApp(
          item.kind === "app"
            ? { id: key, label: key, kind: "app", appName: key }
            : { id: key, label: key, kind: "command", command: key },
        );
        next[key] = r.ok ? "ok" : "miss";
      } catch {
        next[key] = "miss";
      }
    }),
  );
  return next;
}

/** 追加目标到当前清单(store 读数,对话框内写后即生效);满 32(sanitize
    上限)拒加,UI 侧禁用在先,这里是双保险。 */
function appendTarget(target: OpenWithTarget): void {
  const list = getSettingsState().settings.openWithTargets;
  if (list.length >= OPEN_WITH_TARGETS_MAX) return;
  updateSettings({ openWithTargets: [...list, target] });
}

export function OpenWithTab() {
  const { settings } = useSettingsState();
  const targets = settings.openWithTargets;
  const defaultId = settings.openWithDefaultId;
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void probeAll(targets, {}).then(setHealth);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targets 引用随设置写盘变化即重探,懒合并防抖动
  }, [targets]);

  const move = (idx: number, delta: -1 | 1) => {
    const next = [...targets];
    const [item] = next.splice(idx, 1);
    next.splice(idx + delta, 0, item);
    updateSettings({ openWithTargets: next });
  };

  const remove = (id: string) => {
    const next = targets.filter((x) => x.id !== id);
    const patch: { openWithTargets: OpenWithTarget[]; openWithDefaultId?: string } = { openWithTargets: next };
    if (defaultId === id && next.length > 0) patch.openWithDefaultId = next[0].id;
    updateSettings(patch);
  };

  /** 单目标重探(健康徽标点击)。 */
  const reprobe = async (target: OpenWithTarget) => {
    const key = target.kind === "app" ? (target.appName ?? "") : target.command ?? "";
    if (key === "") return;
    setRefreshing(target.id);
    const fresh = await probeAll([target], {});
    setHealth((h) => (fresh[key] ? { ...h, [key]: fresh[key] } : h));
    setRefreshing(null);
  };

  const activeDefaultId = (targets.find((x) => x.id === defaultId) ?? targets[0])?.id;

  return (
    <div className="ow-tab">
      <ul className="ow-list">
        {targets.map((target, idx) => {
          const key = target.kind === "app" ? (target.appName ?? "") : (target.command ?? "");
          const h: Health | null = target.kind === "finder" ? "ok" : (health[key] ?? null);
          const isDefault = activeDefaultId === target.id;
          return (
            <li key={target.id} className="ow-row">
              <span className="ow-row-iconwrap" aria-hidden>
                <OpenWithIcon target={target} size="1.125rem" />
              </span>
              <span className="ow-row-main">
                <span className="ow-row-title">{target.label}</span>
                <span className="ow-row-sub">{openWithSubtitle(target)}</span>
              </span>
              {target.kind !== "finder" && (
                <button
                  type="button"
                  className={`ow-badge${h === "ok" ? " is-ok" : h === "miss" ? " is-miss" : ""}`}
                  onClick={() => void reprobe(target)}
                  disabled={refreshing === target.id}
                  title={t("点击重新探测")}
                >
                  {refreshing === target.id
                    ? t("探测中")
                    : h === "ok"
                      ? t("可用")
                      : h === "miss"
                        ? t("未安装")
                        : t("探测中")}
                </button>
              )}
              {isDefault ? (
                <span className="ow-default-badge">{t("默认")}</span>
              ) : (
                <button
                  type="button"
                  className="ow-row-act ow-setdefault"
                  onClick={() => updateSettings({ openWithDefaultId: target.id })}
                  title={t("设为默认")}
                >
                  <Star size="0.875rem" aria-hidden />
                </button>
              )}
              <span className="ow-row-ops">
                <button
                  type="button"
                  className="ow-row-act"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  title={t("上移")}
                >
                  <CaretUp size="0.875rem" aria-hidden />
                </button>
                <button
                  type="button"
                  className="ow-row-act"
                  onClick={() => move(idx, 1)}
                  disabled={idx === targets.length - 1}
                  title={t("下移")}
                >
                  <CaretDown size="0.875rem" aria-hidden />
                </button>
                <button
                  type="button"
                  className="ow-row-act is-danger"
                  onClick={() => remove(target.id)}
                  title={t("删除")}
                >
                  <Trash size="0.875rem" aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ow-footer">
        <button
          type="button"
          className="ow-add-btn"
          onClick={() => setAdding(true)}
          disabled={targets.length >= OPEN_WITH_TARGETS_MAX}
        >
          <Plus size="0.875rem" aria-hidden />
          {t("添加打开方式")}
        </button>
        <div className="ow-help">{t("文件底部工具条右侧用默认应用直开;菜单里选择即设为默认并打开。")}</div>
        <div className="ow-help">{t("命令类只填可执行文件名,参数写 args 字段(空格串会被当作路径查找而失败)。")}</div>
      </div>
      {adding && (
        <AddOpenWithDialog
          addedIds={new Set(targets.map((x) => x.id))}
          full={targets.length >= OPEN_WITH_TARGETS_MAX}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/** 添加打开方式:预设行列表(未装/已加/清单满禁用)+ 浏览自定义(原生 dialog,Esc/背板关闭)。 */
function AddOpenWithDialog({
  addedIds,
  full,
  onClose,
}: {
  addedIds: Set<string>;
  /** 清单已达 sanitize 上限:所有添加通道禁用(appendTarget 侧另有双保险)。 */
  full: boolean;
  onClose: () => void;
}) {
  const presets = OPEN_WITH_PRESET_CATALOG.filter((p) => p.platforms.includes(detectOpenWithPlatform()));
  const [health, setHealth] = useState<Record<string, Health>>({});

  useEffect(() => {
    void probeAll(presets, {}).then(setHealth);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时探一次
  }, []);

  const browse = async () => {
    const picked = await pickOpenWithApp();
    if (picked) {
      appendTarget(customOpenWithTarget(picked));
      onClose();
    }
  };

  /* 背板点击关闭:click 落在 dialog 自身(背板伪元素)即视为背板。原生 dialog 的
     JSX onClick 会触发 no-noninteractive-element-interactions,改 ref 监听等价实现。 */
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    const onClick = (e: MouseEvent) => {
      if (e.target === dlg) onClose();
    };
    dlg.addEventListener("click", onClick);
    return () => dlg.removeEventListener("click", onClick);
  }, [onClose]);

  return (
    <dialog ref={dlgRef} className="owdlg" aria-label={t("添加打开方式")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="owdlg-title">{t("添加打开方式")}</div>
      <div className="owdlg-list">
        {presets.map((preset) => {
          const asTarget = openWithTargetFromPreset(preset);
          const key = preset.kind === "app" ? (preset.appName ?? "") : (preset.command ?? "");
          const h: Health | null = preset.kind === "finder" ? "ok" : (health[key] ?? null);
          const disabled = full || addedIds.has(preset.id) || h === "miss";
          return (
            <button
              key={preset.id}
              type="button"
              className={`owdlg-row${h === "miss" ? " is-missing" : ""}`}
              onClick={() => {
                appendTarget(asTarget);
                onClose();
              }}
              disabled={disabled}
            >
              <span className="owdlg-iconwrap">
                <OpenWithIcon target={asTarget} size="1.25rem" />
              </span>
              <span className="owdlg-text">
                <span className="owdlg-name">{preset.label}</span>
                <span className="owdlg-sub">{openWithSubtitle(asTarget)}</span>
              </span>
              {preset.kind !== "finder" && (
                <span className={`ow-badge${h === "ok" ? " is-ok" : " is-miss"}`}>
                  {h === "ok" ? t("可用") : t("未安装")}
                </span>
              )}
              {addedIds.has(preset.id) && <span className="owdlg-added">{t("已添加")}</span>}
            </button>
          );
        })}
      </div>
      <div className="owdlg-actions">
        <button
          type="button"
          className="owdlg-browse"
          onClick={() => void browse()}
          disabled={full}
        >
          {t("浏览…选择应用")}
        </button>
      </div>
    </dialog>
  );
}
