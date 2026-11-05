/**
 * RPC 会话输入面 —— 自 sessionTab 拆出(300 行铁则)。在 PTY composer 能力
 * 基线上组合:复用 composer 插件的 @ 文件 / $ skill 触发器、粘贴/拖图写临时
 * 文件注入 "@path " token(附件条联动)等机制;发送仍走 ss.send()。能力边界:
 * 不带 ⌘L 输入历史 / composer.inputRail 的 Mounts 贡献(全局单例桥会被 PTY
 * composer 抢;智能体 ##/提示词 !! 已走本面触发器原生补齐,见 ssComposerRail);
 * 不带命令抽屉(发送路径 PTY 耦合);"/" 触发符不在此激活 —— RPC tab 已有
 * 基于 getCommands 的专属补全,避免双下拉竞争。
 */
import { useMemo, useRef, useState } from "react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { readDragPayload } from "@kernel/internalDrag";
import { useComposerAttachments } from "@plugins/composer/view/useComposerAttachments";
import { useComposerTriggers } from "@plugins/composer/view/useComposerTriggers";
import { AttachmentStrip } from "@plugins/composer/view/AttachmentStrip";
import { useAttachDragProps, usePopupAnchor } from "@plugins/composer/view/composerChrome";
import { SuggestionPortal, PreviewOverlay } from "@plugins/composer/view/composerOverlays";
import { DragOverlay } from "@plugins/composer/view/DragOverlay";
import { ConfirmCard } from "./confirmCard";
import { SsToolbar } from "./ssToolbar";
import { SsWakeRail } from "./ssComposerRail";
import { makeSsKeydown } from "./ssComposerKeys";
import { useComposerResize } from "./ssComposerResize";
import { rpcTriggerSpecs } from "./ssTriggers";
import type { SsSessionState } from "./ssSession";
import type { PiRpcCommand, PiRpcSession } from "../cli-shared/piRpc";

/** useCmdComplete 返回面(键盘/变更钩 + 列表渲染数据)。 */
type CmdComplete = {
  onChange: (v: string) => void;
  onKey: (e: { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean }; preventDefault(): void }) => boolean;
  matches: PiRpcCommand[];
  sel: number;
  setSel: (n: number) => void;
  complete: (c: PiRpcCommand) => void;
  open: boolean;
  cmdList: PiRpcCommand[] | null;
  /** 抽屉钮唤起(草稿空时注入 "/");非空不打扰输入。 */
  wakePalette: () => void;
};

/* / 命令补全(目录懒载缓存 tab 生命期;↑↓ 移动,Tab/Enter 补全,Esc 关闭;
 * 仅补全不代发 —— 引擎自解析斜杠命令)。返回面接 textarea 与补全列表渲染。 */
function useCmdComplete(session: PiRpcSession | null, draft: string, setDraft: (v: string) => void): CmdComplete {
  const [cmdList, setCmdList] = useState<PiRpcCommand[] | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const matches = useMemo(() => {
    if (!open || !cmdList) return [];
    const q = draft.slice(1).toLowerCase();
    return cmdList.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8);
  }, [open, cmdList, draft]);
  const complete = (c: PiRpcCommand) => {
    setDraft(`/${c.name} `);
    setOpen(false);
  };
  /* textarea onKeyDown 前置钩;返回 true = 已消费该键。 */
  const onKey = (e: { key: string; shiftKey: boolean; nativeEvent: { isComposing: boolean }; preventDefault(): void }): boolean => {
    if (!open || matches.length === 0 || e.nativeEvent.isComposing) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSel((sel + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      complete(matches[sel]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return true;
    }
    return false;
  };
  const onChange = (v: string) => {
    setDraft(v);
    const opening = v.startsWith("/") && !v.includes(" ");
    setOpen(opening);
    setSel(0);
    if (opening && cmdList === null && session) {
      void session.getCommands().then(setCmdList).catch(() => setCmdList([]));
    }
  };
  /* 抽屉钮(RPC 版 ⌘K):草稿为空时注入 "/" 唤起命令目录;非空不打扰输入。 */
  const wakePalette = () => {
    if (draft !== "") return;
    onChange("/");
  };
  return { onChange, onKey, matches, sel, setSel, complete, open, cmdList, wakePalette };
}

/* / 命令补全面(列表渲染拆件,守 react-doctor 复杂度;键盘钩仍归 useCmdComplete)。 */
function SsCmdList({ cmd }: { cmd: CmdComplete }) {
  return (
    <div className="ss-cmds" role="listbox">
      {cmd.cmdList === null ? <div className="ss-cmd-hint">{t("载入命令目录…")}</div> : null}
      {cmd.cmdList !== null && cmd.matches.length === 0 ? <div className="ss-cmd-hint">{t("无匹配命令")}</div> : null}
      {cmd.matches.map((c, i) => (
        <button
          type="button"
          key={c.name}
          role="option"
          aria-selected={i === cmd.sel}
          className={"ss-cmd" + (i === cmd.sel ? " is-sel" : "")}
          onMouseDown={(e) => { e.preventDefault(); cmd.complete(c); }}
          onMouseEnter={() => cmd.setSel(i)}
        >
          <span className="ss-cmd-name">/{c.name}</span>
          {c.hint ? <span className="ss-cmd-hint-arg">{c.hint}</span> : null}
          {c.description ? <span className="ss-cmd-desc">{c.description}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* SsComposer = 附件/触发器/补全/审批/拖拽/两段高 的单卡编排,机制均已拆件
 * (ssToolbar/ssComposerRail/ssComposerKeys/ssComposerResize),本函数只剩
 * 接线,复杂度是接线固有,无可再拆。 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function SsComposer({ ss, profileId, cwd }: { ss: SsSessionState; profileId: string; cwd: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /* 触发符集见 rpcTriggerSpecs:"/" 已滤除,不与 getCommands 补全竞争。 */
  const profile = useMemo(() => rpcTriggerSpecs(host.getCliProfile(profileId) ?? null), [profileId]);
  const value = ss.draft;
  const setValue = ss.setDraft;
  const [cursor, setCursor] = useState(value.length);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const cmd = useCmdComplete(ss.sessionRef.current, value, setValue);
  /* 附件(粘贴/拖图 → 临时文件 + "@path " token)与触发器(@ 文件 / $ skill)。 */
  const { removeTokenForAttachment, handlePaste, handleDrop } = useComposerAttachments(
    textareaRef, value, setValue, setCursor, setDragOver,
  );
  const { matches, activeRange, pickIndex, setPickIndex, applyPick, dismiss, triggerSpecs, wakeTrigger } =
    useComposerTriggers({ profile, value, cursor, cwd, textareaRef, setValue, setCursor });
  const { settings } = useSettingsState();
  const cmdOrCtrl = settings.sendShortcut === "cmdOrCtrlEnter";
  /* 两段高(min = 只留工具条) + 拖拽调高(composerH = textarea 上限,持久化;
   * 拖动中直接写行内高,短草稿也即时变高)。 */
  const [stageMin, setStageMin] = useState(false);
  const { composerH, onHandlePointerDown } = useComposerResize((h) => {
    const el = textareaRef.current;
    if (el) el.style.height = `${h}px`;
  });
  const { boxRect, popupBottom, popupMaxHeight } = usePopupAnchor(boxRef);
  const attachDragProps = useAttachDragProps(boxRef, readDragPayload, setDragOver);

  /* 输入框随手长高(基线 96,上限 = composerH 拖拽值;CSS max-height 兜底)。 */
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 96), composerH)}px`;
  };
  /* 键盘编排拆件(ssComposerKeys):confirm > 触发器候选 > / 补全 > 发送。 */
  const onKeyDown = makeSsKeydown({ ss, cmd, matches, pickIndex, setPickIndex, applyPick, dismiss, cmdOrCtrl });

  return (
    <div className="relative" onDrop={(e) => void handleDrop(e)} {...attachDragProps}>
      {/* 拖拽柄:上下拖调对话框高度(PTY panel-handle 同款视觉;min 段隐藏,
          与 PTY min 无分隔条同律) */}
      {!stageMin ? (
        <div
          className="ss-composer-handle"
          title={t("拖拽调整高度")}
          onPointerDown={onHandlePointerDown}
        />
      ) : null}
      <div
        ref={boxRef}
        className={`ss-composer${dragOver ? " is-dragover" : ""}${ss.phase !== "ready" ? " is-disabled" : ""}${stageMin ? " is-min" : ""}`}
      >
        {dragOver ? <DragOverlay /> : null}
        <SsToolbar
          ss={ss}
          profileId={profileId}
          cwd={cwd}
          onExpand={() => setStageMin(false)}
          onCollapse={() => setStageMin(true)}
          onPalette={cmd.wakePalette}
        />
        <AttachmentStrip
          onRemove={removeTokenForAttachment}
          onPreviewImage={(a) => setPreviewSrc(a.previewDataUrl || a.thumbDataUrl)}
        />
        {ss.phase === "ready" && cmd.open ? <SsCmdList cmd={cmd} /> : null}
        <SuggestionPortal
          matches={matches}
          activeRange={activeRange}
          boxRect={boxRect}
          popupBottom={popupBottom}
          popupMaxHeight={popupMaxHeight}
          pickIndex={pickIndex}
          setPickIndex={setPickIndex}
          applyPick={applyPick}
        />
        {ss.confirm ? <ConfirmCard key={ss.confirm.frameId} confirm={ss.confirm} onAnswer={ss.answerConfirm} /> : null}
        {!stageMin ? (
        <textarea
          className="ss-composer-textarea"
          ref={textareaRef}
          style={{ maxHeight: composerH }}
          value={value}
          placeholder={ss.phase !== "ready" ? t("会话未就绪") : ss.busy ? t("输入下一问(排队,当前轮结束自动发送)") : cmdOrCtrl ? t("输入消息,⌘/Ctrl+Enter 发送 · / 唤起命令") : t("输入消息,Enter 发送 · / 唤起命令")}
          disabled={ss.phase !== "ready"}
          onChange={(e) => {
            cmd.onChange(e.target.value);
            setCursor(e.target.selectionStart);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onBlur={(e) => {
            if (!boxRef.current?.contains(e.relatedTarget as Node | null)) dismiss();
          }}
          onInput={(e) => autoResize(e.currentTarget)}
          onPaste={(e) => void handlePaste(e)}
          onKeyDown={onKeyDown}
        />
        ) : null}
        {!stageMin ? (
        <SsWakeRail
          triggerSpecs={triggerSpecs}
          wakeTrigger={wakeTrigger}
          canSend={ss.phase === "ready" && !!value.trim()}
          onSend={ss.send}
        />
        ) : null}
        <PreviewOverlay src={previewSrc} onClose={() => setPreviewSrc(null)} />
      </div>
    </div>
  );
}
