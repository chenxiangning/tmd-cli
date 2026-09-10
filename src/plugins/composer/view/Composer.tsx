/**
 * Composer 视图 —— textarea + 触发器下拉 + 附件条 + 翻译 → PTY。
 *
 * 行为:
 * - 发送快捷键由 settings.sendShortcut 决定(默认 Enter 发送 / Shift+Enter 换行;⌘/Ctrl+Enter 模式下相反)
 * - 触发符(由当前会话 cli profile 声明)在光标前识别后,弹下拉
 *   - 候选来自:
 *     @ fsListDir(file 触发)
 *     / profile.suggestions.command
 *     $ profile.suggestions.skill
 *   - 候选面板支持 ↑↓/Enter/Tab/Esc 选中,选中替换触发器 + token
 * - 发送时把命中 "$token" → translate("/skill:token")(omp/pi 已声明)
 * - 拖入/粘贴图片 → 写临时文件 → 注册 attachment → textarea 注入 "@path "
 * - 拖拽悬停 composer → accent 内环 + 虚线遮罩(仅外部文件/文件树拖拽;附件重排不弹)
 * - attachment × 删除 → 同步移除 textarea 里对应 "@path " 文本
 * - textarea 里删除 "@path " 文本 → MutationObserver 移除对应 attachment
 *
 * 命令抽屉与触发器下拉拆至 useComposerDrawer.ts / useComposerTriggers.ts
 * (文件规模铁则)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { host } from "@kernel/host";
import { composerSendTransforms, composerWakeRef } from "@kernel/composerExt";
import { t } from "@kernel/i18n";
import { useComposerStage } from "@kernel/composerStage";
import { useComposerTriggers } from "./useComposerTriggers";
import { useComposerAttachments } from "./useComposerAttachments";
import { emitPromptSent, readPromptGate } from "../promptGate";
import { Mounts } from "@kernel/Mounts";
import { useSettingsState } from "@kernel/settings";
import { getTerminalHandle } from "@kernel/messageAnchors";
import { useWorkspaces } from "@kernel/workspace";
import { readDragPayload } from "@kernel/internalDrag";
import { prepareSendPayload } from "../serialize/serialize";
import { SuggestionList } from "./SuggestionList";
import { DragOverlay } from "./DragOverlay";
import { shouldSendOnEnter } from "./enterAction";
import { useActiveProfile } from "../state/useActiveProfile";
import { CommandDrawer } from "./CommandDrawer";
import { resolveArrowIntent } from "./arrowIntent";
import { AttachmentStrip } from "./AttachmentStrip";
import { useAttachDragProps, usePopupAnchor } from "./composerChrome";
import { AnchorRail } from "./AnchorRail";
import { clearAttachments } from "../state/attachments";
import { useComposerDrawer } from "./useComposerDrawer";
import { composerSendRef } from "./composerSendRef";

export function Composer() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const profile = useActiveProfile();
  const { settings } = useSettingsState();
  /* 附件交互(拖放/粘贴/token 同步)职责在 useComposerAttachments */
  const { removeTokenForAttachment, handlePaste, handleDrop } = useComposerAttachments(
    ref,
    value,
    setValue,
    setCursor,
    setDragOver,
  );
  /* 五段高度最底段(min,仅工具栏条):隐藏输入区(附件条/textarea/锚点栏),工具栏保留 */
  const inputHidden = useComposerStage() === "min";
  const workspaces = useWorkspaces();
  const cwd = useMemo(
    () => workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? workspaces.list[0]?.root ?? "",
    [workspaces],
  );
  const { drawerOpen, drawerItems, sendFromDrawer, insertFromDrawer, openFromDrawer } =
    useComposerDrawer({
      profile,
      cwd,
      textareaRef: ref,
      value,
      setValue,
      setCursor,
    });
  const {
    matches,
    activeRange,
    pickIndex,
    setPickIndex,
    setMatches,
    applyPick,
    wakeTrigger,
    dismiss,
  } = useComposerTriggers({
    profile,
    value,
    cursor,
    cwd,
    textareaRef: ref,
    setValue,
    setCursor,
  });

  /* composer.send 命令桥:每次渲染同步最新发送闭包(latest-ref),卸载断开。
     ⌘K 开合已收编为 composer.toggleDrawer 命令(注册见插件入口);发送路径零改动 */
  useEffect(() => {
    composerSendRef.current = () => sendCurrent();
    composerWakeRef.current = wakeTrigger;
    return () => {
      composerSendRef.current = null;
      composerWakeRef.current = null;
    };
  });

  function sendCurrent() {
    if (!value.trim()) return;
    if (!profile || !host.getActiveSessionId()) return;
    /* git 联动:`/commit <msg>` → 预填 git 面板提交框。
     * 契约源头:src/plugins/git/gitEvents.ts(GIT_PREFILL_TOPIC);
     * 插件间不互相 import,topic 字符串即契约(事件总线惯例)。
     * 仅预填 —— 文本照常发给 CLI,commit 执行权永在 git 面板按钮。 */
    const trimmed = value.trim();
    if (trimmed.startsWith("/commit ")) {
      host.events.emit("git://composer-prefill", { message: trimmed.slice(8).trim() });
    }
    const sid = host.getActiveSessionId()!;
    /* 发送变换(composerExt 契约):仅用户自然语言消息走;抽屉/工具栏命令发送不经此 */
    const payload = prepareSendPayload(profile, value,
      composerSendTransforms().map((fn) => (text: string) => fn(text, sid)));
    const gate = readPromptGate(sid); // 轮次闸写前现读:writeSession 作答即清 ask 等待态
    host.writeSession(sid, payload);
    /* 锚点快照信号(checkpoints 消费)过轮次闸:ask 作答/轮中斜杠命令不开轮不广播;幕布击键同走 writeSession,不能当 prompt */
    emitPromptSent(gate, sid, trimmed);
    setValue("");
    clearAttachments();
    setMatches(null);
  }


  /* 弹窗悬停锚定 + 拖拽判定(实现见 composerChrome.ts) */
  const { boxRect, popupBottom, popupMaxHeight } = usePopupAnchor(composerRef);
  const attachDragProps = useAttachDragProps(composerRef, readDragPayload, setDragOver);
  return (
    <div
      onDrop={handleDrop}
      {...attachDragProps}
      className="relative flex h-full flex-col bg-(--tmd-bg-base)"
    >
      <div
        ref={composerRef}
        className={`relative flex h-full flex-col overflow-hidden border-t bg-(--tmd-bg-elevated) ${
          dragOver
            ? "border-(--tmd-accent) ring-2 ring-inset ring-(--tmd-accent-soft)"
            : "border-(--tmd-border)"
        }`}
      >
        <Mounts point="composer.statusBar" />
        {!inputHidden && (
        <AttachmentStrip onRemove={removeTokenForAttachment} onPreviewImage={(a) => setPreviewSrc(a.previewDataUrl || a.thumbDataUrl)} />
        )}
        {matches && activeRange && boxRect && createPortal(
          <SuggestionList
            style={{
              left: boxRect.left + 12,
              width: boxRect.width - 24,
              bottom: popupBottom,
              maxHeight: popupMaxHeight,
            }}
            matches={matches}
            pickIndex={pickIndex}
            onPick={applyPick}
            onHoverIndex={setPickIndex}
          />,
          document.body,
        )}
        {!inputHidden && (
        <>
        <textarea
          id="composer-textarea"
          ref={ref}
          value={value}
          placeholder={settings.sendShortcut === "cmdOrCtrlEnter"
            ? t("输入消息,⌘/Ctrl+回车发送,回车换行。可用 / 命令 / $ skill / @ 文件 / !! 提示词 / ## 智能体。拖入文件或 ⌘V 粘贴图片会自动插入引用。")
            : t("输入消息,回车发送,Shift+回车换行。可用 / 命令 / $ skill / @ 文件 / !! 提示词 / ## 智能体。拖入文件或 ⌘V 粘贴图片会自动插入引用。")}
          className="min-h-0 flex-1 resize-none bg-transparent p-0 pr-10 text-sm leading-[1.58] text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
          onChange={(e) => {
            setValue(e.target.value);
            setCursor(e.target.selectionStart);
          }}
          /* onSelect 覆盖点击与 ←/→ 移动光标:value 不变的移动不触发 onChange,
             不同步会让下拉用过期 activeRange 做 token 替换,错插正文 */
          onSelect={(e) => {
            setCursor(e.currentTarget.selectionStart);
          }}
          /* 失焦到 composer 外(点幕布/侧栏等)→ 收起候选面板。
             面板内部点击不触发此 blur(面板容器 onMouseDown preventDefault 保焦) */
          onBlur={(e) => {
            if (!composerRef.current?.contains(e.relatedTarget as Node | null)) {
              dismiss();
            }
          }}
          onKeyDown={(e) => {
            /* 判定顺序契约见 openspec design §6:IME → 下拉 → 非空 → 移交。
               IME 组词期全部放行给输入法:↑↓ 属候选窗导航,Enter 属候选上屏,
               此处拦截会把组词文本错替换成下拉首项 */
            const composing = e.nativeEvent.isComposing;
            if (e.key === "ArrowDown" && matches && !composing) {
              e.preventDefault();
              setPickIndex((i: number) => (matches.length ? (i + 1) % matches.length : 0));
              return;
            }
            if (e.key === "ArrowUp" && matches && !composing) {
              e.preventDefault();
              setPickIndex((i: number) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
              return;
            }
            if (matches && !composing) {
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (matches[pickIndex]) applyPick(matches[pickIndex]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                dismiss();
                return;
              }
            }
            /* 空输入 ↑↓ → 焦点移交幕布(部分 CLI 终端里方向键有历史/选择语义);
               判定顺序契约见 openspec design §6:IME → 下拉 → 非空 → 移交 */
            if (
              (e.key === "ArrowUp" || e.key === "ArrowDown") &&
              resolveArrowIntent({
                key: e.key,
                value,
                hasMatches: !!matches,
                isComposing: e.nativeEvent.isComposing,
              }) === "handoff"
            ) {
              e.preventDefault();
              const sid = host.getActiveSessionId();
              if (sid) getTerminalHandle(sid)?.focus();
              return;
            }
            if (e.key === "Enter" &&
              shouldSendOnEnter(
                {
                  shiftKey: e.shiftKey,
                  metaKey: e.metaKey,
                  ctrlKey: e.ctrlKey,
                  isComposing: e.nativeEvent.isComposing,
                },
                settings.sendShortcut,
              )) {
              e.preventDefault();
              sendCurrent();
            }
          }}
          onPaste={handlePaste}
        />
        {/* 资产唤醒入口(assets 插件贡献):右缘竖向图标列,几何见 composer-anchors.css */}
        <div className="composer-input-rail">
          <Mounts point="composer.inputRail" />
        </div>
        {/* 对话锚点栏:右缘 dash 导航,数据/跳转走 kernel messageAnchors */}
        <AnchorRail />
        </>
        )}
        {/* 命令抽屉:统一悬在对话框上方(portal + fixed,常挂以便滑出动画) */}
        {boxRect && createPortal(
          <CommandDrawer
            style={{
              right: window.innerWidth - boxRect.right,
              bottom: popupBottom,
              maxHeight: popupMaxHeight,
            }}
            open={drawerOpen}
            items={drawerItems}
            onSend={sendFromDrawer}
            onInsert={insertFromDrawer}
            onOpen={openFromDrawer}
          />,
          document.body,
        )}
        {dragOver && <DragOverlay />}
      </div>
      {previewSrc && (
        <div
          role="presentation"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <img src={previewSrc} alt="preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}
