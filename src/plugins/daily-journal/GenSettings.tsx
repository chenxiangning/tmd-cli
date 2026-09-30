/**
 * 生成设置弹层(插件私有配置,落 meta.json;原型「生成设置」modal)——
 * 定时开关+时间 / 增量策略 / 引擎(有会话扫描能力的 profile)/ 模型 / 节假日。
 */
import { useEffect, useState } from "react";
import { GearSix } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogShell } from "@kernel/DialogShell";
import { host } from "@kernel/host";
import { updateConfig, useJournalState } from "./journalStore";
import { ensureHolidays } from "./holidays";
import { listModels } from "@plugins/memory-coordinator/modelCatalog";
/* 品牌字形映射(cli-shared,先例:omp/pi/… 十家 renderIcon + mobile EngineMark 已消费)。 */
import { engineGlyphOf } from "@plugins/cli-shared/engineGlyphMap";
import type { JournalConfig } from "./journalFiles";

/** 增量策略逐项说明(随选中项切换;语义以 journalSchedule/genSession 实际消费为准:
 *  三档只闸「会话退出自动增量」一条路,定时/补跑与手动生成各档均可用)。 */
const INC_HINT: Record<JournalConfig["incPolicy"], string> = {
  auto: "会话收尾约 45 秒后自动整理当日:已有文章把新增会话追加成新节(旧节一字不动,留并入时间痕),还没有文章则当天首次成文。",
  manual: "收尾后不自动写;当日文章只在主动发起时更新(文章 tab / 日格「增量并入 · 生成此日 / 重试生成」、月视图「补齐待生成」)。",
  timer: "当日会话不实时成文,留到次日定时任务一次归纳成文(需开着「定时生成」);想当天出文随时可手动点生成。",
};

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="dj-seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function GenSettings({ onClose }: { onClose: () => void }) {
  const current = useJournalState().config;
  const [cfg, setCfg] = useState<JournalConfig>({ ...current });
  const engines = host.getCliProfiles().filter((p) => p.listSessions);
  /* 引擎失效回落首个可用(派生值,不在渲染期 setState)。 */
  const engine = engines.some((p) => p.id === cfg.engine) ? cfg.engine : (engines[0]?.id ?? cfg.engine);
  /* 模型目录:实时拉取所选引擎可用模型(omp/opencode 有列表命令;其余降级手填)。 */
  const [models, setModels] = useState<{ selector: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    void listModels(engine as "omp")
      .then((m) => {
        /* 慢引擎迟到列表丢弃:引擎已切走后落地会把下拉错配到旧引擎(MC10 同款)。 */
        if (!cancelled) {
          setModels(m);
          setModelsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engine]);
  const save = () => {
    updateConfig({ ...cfg, engine });
    void ensureHolidays(new Date().getFullYear(), true);
    onClose();
  };
  return (
    <DialogShell
      title={t("生成设置")}
      icon={<GearSix size={13} />}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="dj-btn" onClick={onClose}>
            {t("取消")}
          </button>
          <button type="button" className="dj-btn dj-btn-primary" onClick={save}>
            {t("保存")}
          </button>
        </>
      }
    >
      <div className="dj-modal-body dj-modal-body-flush">
          <div className="dj-frow">
            <span className="dj-flabel">{t("定时生成")}</span>
            <div className="dj-timerow">
              <Seg
                value={cfg.timerOn ? "on" : "off"}
                options={[
                  ["on", t("开")],
                  ["off", t("关")],
                ]}
                onChange={(v) => setCfg((c) => ({ ...c, timerOn: v === "on" }))}
              />
              <span className="dj-timerow-text">{t("每日")}</span>
              <input
                className="dj-tinput"
                value={cfg.timerTime}
                onChange={(e) => {
                  const v = e.target.value;
                  setCfg((c) => ({ ...c, timerTime: /^([01]?\d|2[0-3]):[0-5]?\d$/.test(v) ? v : c.timerTime }));
                }}
                onBlur={(e) => setCfg((c) => ({ ...c, timerTime: e.target.value.trim() || "08:00" }))}
                aria-label={t("时间")}
              />
              <span className="dj-timerow-text">{t("生成前一日汇总文章")}</span>
            </div>
            <span className="dj-hint">{t("到点未运行则下次启动补跑;一天一篇,重复生成整篇替换。便签不受影响。")}</span>
          </div>
          <div className="dj-frow">
            <span className="dj-flabel">{t("增量策略(当日文章何时更新)")}</span>
            <Seg
              value={cfg.incPolicy}
              options={[
                ["auto", t("跟随实时")],
                ["manual", t("手动确认")],
                ["timer", t("仅定时")],
              ]}
              onChange={(v) => setCfg((c) => ({ ...c, incPolicy: v }))}
            />
            <span className="dj-hint">{t(INC_HINT[cfg.incPolicy])}</span>
          </div>
          <div className="dj-frow">
            <span className="dj-flabel">{t("引擎")}</span>
            <div className="dj-seg">
              {engines.map((p) => {
                const Brand = engineGlyphOf(p.id);
                return (
                  <button key={p.id} type="button" className={engine === p.id ? "on" : ""} onClick={() => setCfg((c) => ({ ...c, engine: p.id }))}>
                    {Brand && <Brand size={12} />}
                    {p.id}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="dj-frow">
            <span className="dj-flabel">{t("模型(空 = 引擎默认)")}</span>
            {models.length > 0 ? (
              <select
                className="dj-tinput dj-tinput-wide dj-tselect"
                value={cfg.model}
                onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
                title={t("列表实时取自 {engine} 可用模型", { engine })}
              >
                <option value="">{t("跟随 {engine} 默认模型", { engine })}</option>
                {models.map((m) => (
                  <option key={m.selector} value={m.selector}>
                    {m.selector}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="dj-tinput dj-tinput-wide"
                value={cfg.model}
                placeholder={modelsLoading ? t("拉取模型列表中…") : t("{engine} 无列表命令,手动填 provider/model", { engine })}
                onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value.trim() }))}
              />
            )}
          </div>
          <div className="dj-frow">
            <span className="dj-flabel">{t("节假日数据(联网)")}</span>
            <Seg
              value={cfg.holidaysOn ? "on" : "off"}
              options={[
                ["on", t("开")],
                ["off", t("关")],
              ]}
              onChange={(v) => setCfg((c) => ({ ...c, holidaysOn: v === "on" }))}
            />
            <span className="dj-hint">{t("启动与每日增量时拉取,成功缓存全年;网络不通用缓存;无缓存仅周末底纹。")}</span>
          </div>
        </div>
    </DialogShell>
  );
}
