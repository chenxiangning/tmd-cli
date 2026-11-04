/**
 * RPC 会话输入面 —— 自 sessionTab 拆出(300 行铁则)。在 PTY composer 能力
 * 基线上组合:复用 composer 插件的 @ 文件 / $ skill 触发器、粘贴/拖图写临时
 * 文件注入 "@path " token(附件条联动)等机制;发送仍走 ss.send()。能力边界:
 * 不带 ⌘L 输入历史 / composer.inputRail 贡献(PTY 会话专属,全局单例冲突),
 * 不带命令抽屉(发送路径 PTY 耦合);"/" 触发符不在此激活 —— RPC tab 已有
 * 基于 getCommands 的专属补全,避免双下拉竞争。
 */
import { useMemo, useRef, useState } from "react";
import { At, PaperPlaneRight, Sparkle } from "@phosphor-icons/react";
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
  return { onChange, onKey, matches, sel, setSel, complete, open, cmdList };
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

/* 左下唤醒轨 + 发送(与 PTY composer 同几何:composer-anchors.css 的
 * .composer-input-rail / .composer-rail-btn;贡献 Mount 不带入,那些是
 * PTY 会话专属且经全局单例桥,会和 PTY composer 抢注册)。
 * 引擎声明了哪个触发符就亮哪个(图标即能力探针,隐藏优于置灰)。 */
function SsWakeRail({ triggerSpecs, wakeTrigger, canSend, onSend }: {
  triggerSpecs: readonly { char: string }[];
  wakeTrigger: (char: string) => void;
  canSend: boolean;
  onSend: () => void;
}) {
  const wake = (char: string) => triggerSpecs.some((s) => s.char === char);
  return (
    <div className="composer-input-rail">
      {wake("@") ? (
        <button type="button" className="composer-rail-btn" title={t("@ 引用文件")} aria-label={t("@ 引用文件")} onClick={() => wakeTrigger("@")}>
          <At size="0.875rem" />
        </button>
      ) : null}
      {wake("$") ? (
        <button type="button" className="composer-rail-btn" title={t("$ 调用技能")} aria-label={t("$ 调用技能")} onClick={() => wakeTrigger("$")}>
          <Sparkle size="0.875rem" />
        </button>
      ) : null}
      <button
        type="button"
        className="composer-rail-btn ss-composer-send"
        title={t("发送")}
        aria-label={t("发送")}
        disabled={!canSend}
        onClick={onSend}
      >
        <PaperPlaneRight size="0.875rem" />
      </button>
    </div>
  );
}

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
  const { boxRect, popupBottom, popupMaxHeight } = usePopupAnchor(boxRef);
  const attachDragProps = useAttachDragProps(boxRef, readDragPayload, setDragOver);

  /* 输入框随手长高(基线 96px,上限 220px 与 CSS max-height 同值;CSS overflow 兜底滚动)。 */
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 96), 220)}px`;
  };
  /* 触发器候选键:↑↓ 移动,Enter/Tab 选定,Esc 关闭(唤醒注入未消费则回收)。 */
  const triggerKeys = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!matches || matches.length === 0) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setPickIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (e.nativeEvent.isComposing) return true;
      e.preventDefault();
      applyPick(matches[pickIndex]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
      return true;
    }
    return false;
  };

  return (
    <div className="relative" onDrop={(e) => void handleDrop(e)} {...attachDragProps}>
      <div
        ref={boxRef}
        className={`ss-composer${dragOver ? " is-dragover" : ""}${ss.phase !== "ready" ? " is-disabled" : ""}`}
      >
        {dragOver ? <DragOverlay /> : null}
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
        <textarea
          className="ss-composer-textarea"
          ref={textareaRef}
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
          onKeyDown={(e) => {
            if (ss.confirm && !e.nativeEvent.isComposing && e.key === "Escape") {
              e.preventDefault();
              ss.answerConfirm(false);
              return;
            }
            /* 触发器候选 > / 命令补全 > 发送(优先级序,首个消费即返回)。 */
            if (triggerKeys(e)) return;
            if (cmd.onKey(e)) return;
            const sendKey = cmdOrCtrl
              ? e.key === "Enter" && (e.metaKey || e.ctrlKey)
              : e.key === "Enter" && !e.shiftKey;
            if (sendKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ss.send();
            }
          }}
        />
        <SsWakeRail
          triggerSpecs={triggerSpecs}
          wakeTrigger={wakeTrigger}
          canSend={ss.phase === "ready" && !!value.trim()}
          onSend={ss.send}
        />
        <PreviewOverlay src={previewSrc} onClose={() => setPreviewSrc(null)} />
      </div>
    </div>
  );
}
