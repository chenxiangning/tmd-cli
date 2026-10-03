/**
 * 三态胶囊 composer(豆包式重做,spec 2026-10-03-mobile-composer-redesign):
 * 常态胶囊条(相机=相册选图/输入框/键条开关/加号或发送蓝圆)+ 挂图态
 * (大圆角缩略卡 + 提示 chips,点 chip 追加填草稿由人确认发送)+ 「+」四格
 * 面板(相册/切模型/检查点/快捷键,输入条下方展开、动作后收起)。草稿/挂图/
 * 发送状态留 SessionScreen,本件只持面板开合与软键盘感知;ShotStrip/SendErrBars
 * 自 SessionChrome 随迁,键条随迁渲染(软键盘弹起或面板展开时整行隐藏)。
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Camera,
  ClockCounterClockwise,
  Images,
  Keyboard,
  Plus,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { mobileEnterAction } from "./enterSend";
import { KeyToolbar } from "./KeyToolbar";
import { CHIP_PROMPTS, joinPrompt } from "./composerChips";

/** 「+」四格面板(参考图2,去语音条;全部现有能力):
 *  相册 = pickImage 选图;切模型 = 填 /model 草稿(发送后键条驱动 TUI);
 *  检查点 = CkptSheet(无 cwd 置灰);快捷键 = 键条开关(格随 kbOn 点亮)。 */
export function PlusPanel(props: {
  shotBusy: boolean;
  ckptReady: boolean;
  kbOn: boolean;
  onShot: () => void;
  onModel: () => void;
  onCkpt: () => void;
  onToggleKb: () => void;
}) {
  return (
    <div className="cp-panel">
      <button type="button" className="cp-tile" disabled={props.shotBusy} onClick={props.onShot}>
        <Images size={21} />
        {t("相册")}
      </button>
      <button type="button" className="cp-tile" onClick={props.onModel}>
        <SlidersHorizontal size={21} />
        {t("切模型")}
      </button>
      <button type="button" className="cp-tile" disabled={!props.ckptReady} onClick={props.onCkpt}>
        <ClockCounterClockwise size={21} />
        {t("检查点")}
      </button>
      <button type="button" className={"cp-tile" + (props.kbOn ? " on" : "")} onClick={props.onToggleKb}>
        <Keyboard size={21} />
        {t("快捷键")}
      </button>
    </div>
  );
}

/** 挂图缩略卡行(参考图1:大圆角卡 + 右上深色 ✕ + 尾随「+」瓷砖再加一张);
 *  空态返 null(加图走胶囊条相机钮),点缩略图全屏看图。 */
function ShotStrip(props: {
  shots: { path: string; url: string }[];
  addDisabled: boolean;
  onAdd: () => void;
  onRemove: (path: string) => void;
  onPreview: (url: string) => void;
}) {
  if (!props.shots.length) return null;
  return (
    <div className="shots">
      {props.shots.map((s) => (
        <div className="shot" key={s.path}>
          <button type="button" className="shot-img-btn" aria-label={t("查看大图")} onClick={() => props.onPreview(s.url)}>
            <img src={s.url} alt="" />
          </button>
          <button type="button" className="shot-x" aria-label={t("移除图片")} onClick={() => props.onRemove(s.path)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="cp-shot-add" aria-label={t("再加一张")} disabled={props.addDisabled} onClick={props.onAdd}>
        <Plus size={20} />
      </button>
    </div>
  );
}

/** 悬浮错误条组(浮在 composer 上缘,不挤布局;发送失败条内嵌重试)。 */
function SendErrBars(props: { sendErr: boolean; shotErr: boolean; onRetry: () => void }) {
  if (!props.sendErr && !props.shotErr) return null;
  return (
    <div className="m-errs">
      {props.sendErr ? (
        <div className="m-err-bar" role="alert">
          <span>{t("发送失败,消息已保留")}</span>
          <button type="button" onClick={props.onRetry}>{t("重试")}</button>
        </div>
      ) : null}
      {props.shotErr ? (
        <div className="m-err-bar" role="alert">
          <span>{t("选图失败,请重试")}</span>
        </div>
      ) : null}
    </div>
  );
}

/* 移动端单屏组件:三态分支/面板四格/键条开合是本质复杂度,拆子组件需跨层透传
 * 10+ 个状态回调,弊大于利(先例同 SessionScreen 的复杂度豁免注释)。 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function Composer(props: {
  sessionId: string;
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  sendErr: boolean;
  shotErr: boolean;
  onRetry: () => void;
  shots: { path: string; url: string }[];
  shotBusy: boolean;
  onShot: () => void;
  onRemoveShot: (path: string) => void;
  onPreview: (url: string) => void;
  ckptReady: boolean;
  onCkpt: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [panel, setPanel] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  /* 键条开关(pref 持久化);软键盘弹起时键条整行隐藏(KeyToolbar 契约)。 */
  const [kbOn, setKbOn] = useState(() => {
    try {
      return localStorage.getItem("tmd.keybar.on") !== "0";
    } catch {
      return true;
    }
  });
  const toggleKb = () => {
    const n = !kbOn;
    setKbOn(n);
    try {
      localStorage.setItem("tmd.keybar.on", n ? "1" : "0");
    } catch { /* 隐私态 */ }
  };
  /* 自动长高:单行起步、132px 封顶(拖拽把手已删,纯内容驱动)。 */
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [props.draft]);
  /* chip 填稿 = 追加不覆盖(joinPrompt,保已打文字);切模型 = 替换(命令语义)。
   * 两者都只填草稿并聚焦,发送由人确认(不自动发空枪)。 */
  const fillDraft = (v: string) => {
    props.onDraft(v);
    taRef.current?.focus();
  };
  const hasBody = props.draft.trim().length > 0 || props.shots.length > 0;
  return (
    <>
      <div className={"composer" + (kbOn && !kbOpen ? " kb-on" : "")}>
        <SendErrBars sendErr={props.sendErr} shotErr={props.shotErr} onRetry={props.onRetry} />
        <ShotStrip
          shots={props.shots}
          addDisabled={props.shotBusy}
          onAdd={props.onShot}
          onRemove={props.onRemoveShot}
          onPreview={props.onPreview}
        />
        {props.shots.length > 0 && (
          <div className="cp-chips">
            {CHIP_PROMPTS.map((c) => (
              <button key={c.label} type="button" className="cp-chip" onClick={() => fillDraft(joinPrompt(props.draft, c.prompt))}>
                {t(c.label)}
                <ArrowRight size={11} />
              </button>
            ))}
          </div>
        )}
        <div className="cp-pill">
          <button type="button" className="cp-ic" aria-label={t("相册选图")} disabled={props.shotBusy} onClick={props.onShot}>
            <Camera size={21} />
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={props.draft}
            placeholder={t("发消息…")}
            onFocus={() => { setKbOpen(true); setPanel(false); }}
            onBlur={() => setKbOpen(false)}
            onChange={(e) => props.onDraft(e.target.value)}
            onKeyDown={(e) => {
              /* 裸 Enter=换行(平台惯例),发送归 ↑ 钮与 ⌘/Ctrl+Enter;IME 组合期
               * 一律不拦截(mobileEnterAction,守卫契约同桌面 enterAction)。 */
              if (e.key !== "Enter") return;
              if (mobileEnterAction({
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                isComposing: e.nativeEvent.isComposing,
                keyCode: e.keyCode,
              }) === "send") {
                e.preventDefault();
                props.onSend();
              }
            }}
          />
          <button type="button" className={"cp-ic" + (kbOn ? " on" : "")} aria-label={t("键盘工具条")} onClick={toggleKb}>
            <Keyboard size={19} />
          </button>
          {panel ? (
            <button type="button" className="cp-send close" aria-label={t("收起面板")} onClick={() => setPanel(false)}>
              <X size={16} />
            </button>
          ) : hasBody ? (
            <button type="button" className="cp-send" aria-label={t("发送")} disabled={props.sending} onClick={props.onSend}>
              {props.sending ? "…" : <ArrowUp size={16} />}
            </button>
          ) : (
            <button type="button" className="cp-ic" aria-label={t("打开面板")} onClick={() => setPanel(true)}>
              <Plus size={22} />
            </button>
          )}
        </div>
        {/* 面板在输入条下方展开(参考图2:条在上、格在下;占键盘同款心理槽位)。
         *  面板是瞬时菜单:四格动作(含相册)一律执行后收起;连加图走缩略行
         *  「+」瓷砖;面板展开期间键条让位(hidden 加 panel 项)。 */}
        {panel && (
          <PlusPanel
            shotBusy={props.shotBusy}
            ckptReady={props.ckptReady}
            kbOn={kbOn}
            onShot={() => { setPanel(false); props.onShot(); }}
            onModel={() => { setPanel(false); fillDraft("/model"); }}
            onCkpt={() => { setPanel(false); props.onCkpt(); }}
            onToggleKb={() => { setPanel(false); toggleKb(); }}
          />
        )}
      </div>
      <KeyToolbar sessionId={props.sessionId} hidden={kbOpen || !kbOn || panel} />
    </>
  );
}
