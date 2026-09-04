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
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { KernelTopics } from "@kernel/events";
import { Mounts } from "@kernel/Mounts";
import { openSettingsPanel, useSettingsState } from "@kernel/settings";
import { setFilePanelMode } from "@kernel/filePanel";
import { getTerminalHandle } from "@kernel/messageAnchors";
import { useWorkspaces } from "@kernel/workspace";
import { readDragPayload, clearDragPayload } from "@kernel/internalDrag";
import { findActiveTrigger, prepareSendPayload } from "../serialize/serialize";
import type { SuggestionMatch } from "../triggers/suggest";
import { lookupSuggestions } from "../triggers/suggest";
import { SuggestionList } from "./SuggestionList";
import { shouldSendOnEnter } from "./enterAction";
import { useActiveProfile } from "../state/useActiveProfile";
import { toggleDrawer, useDrawerOpen } from "../state/drawerOpen";
import { CommandDrawer } from "./CommandDrawer";
import {
  resolveProfileDrawerItems,
  resolvePluginDrawerItems,
  type DrawerItem,
} from "../drawerItems";
import { resolveArrowIntent } from "./arrowIntent";
import { AttachmentStrip } from "./AttachmentStrip";
import { useAttachDragProps, usePopupAnchor } from "./composerChrome";
import { AnchorRail } from "./AnchorRail";
import {
  addAttachment,
  classifyAttachment,
  clearAttachments,
  getAttachments,
  MAX_ATTACHMENTS,
  makeImageThumb,
  removeAttachmentByPath,
  type Attachment,
} from "../state/attachments";

const ATTACH_TOKEN_RE = /@[^\s@]+/g;

/** 抽屉条目 → 实际写入幕布的文本(token 覆盖默认;发送前统一走 prepareSendPayload)。 */
function drawerWireText(item: DrawerItem): string {
  if (item.token) return item.token.trim();
  return item.section === "skill" ? `$${item.name}` : `/${item.name}`;
}

export function Composer() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [matches, setMatches] = useState<SuggestionMatch[] | null>(null);
  const [activeRange, setActiveRange] = useState<[number, number] | null>(null);
  const [pickIndex, setPickIndex] = useState(0);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const profile = useActiveProfile();
  const { settings } = useSettingsState();

  /* ── 命令抽屉(openspec/changes/composer-command-drawer)──
     数据:profile 四分区解析 + 内核插件注册表;执行:三模式回调交回本组件 */
  const drawerOpen = useDrawerOpen();
  const workspaces = useWorkspaces();
  const cwd = useMemo(
    () => workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? workspaces.list[0]?.root ?? "",
    [workspaces],
  );
  const [drawerItems, setDrawerItems] = useState<DrawerItem[]>([]);
  useEffect(() => {
    if (!drawerOpen) return;
    if (!profile) {
      /* 会话消失(profile → null)时清掉上一个 CLI 的残留条目,只留插件区 */
      setDrawerItems(resolvePluginDrawerItems());
      return;
    }
    let cancelled = false;
    void resolveProfileDrawerItems(profile, cwd).then((items) => {
      if (!cancelled) setDrawerItems([...items, ...resolvePluginDrawerItems()]);
    });
    return () => { cancelled = true; };
  }, [drawerOpen, profile, cwd]);

  /* ⌘/Ctrl+K 开合(监听放常挂的 Composer:抽屉关着也要能开)。
     与工具栏按钮同门控:无活跃会话不开;按住不放不重复触发 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (e.repeat || !host.getActiveSessionId()) return;
        e.preventDefault();
        toggleDrawer();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* send 与手动发送完全同路径(prepareSendPayload → host.writeSession,translate 生效,零拦截;
     writeSession 同时锚定对话(呼吸灯首写闸) —— 用户首写后的输出才按对话语义结算呼吸灯);
     返回写入的 wire 文本(translate 后)供抽屉 toast 展示;无会话/无 profile 返回空串
     (spec:静默守卫,不弹"已发送"假反馈) */
  function sendFromDrawer(item: DrawerItem): string {
    const sid = host.getActiveSessionId();
    if (!sid || !profile) return "";
    const text = drawerWireText(item);
    const wire = prepareSendPayload(profile, text);
    host.writeSession(sid, wire);
    host.events.emit(KernelTopics.promptSent, { sessionId: sid, text: text.slice(0, 400) });
    return wire.replace(/\r$/, "");
  }

  function insertFromDrawer(item: DrawerItem): void {
    const token = item.token ?? (item.section === "skill" ? `$${item.name} ` : `/${item.name} `);
    if (ref.current) insertAtCursor(ref.current, token);
  }

  function openFromDrawer(item: DrawerItem): void {
    if (item.panelId) setFilePanelMode(item.panelId);
    else openSettingsPanel();
  }


  const triggerSpecs = useMemo(() => profile?.triggers ?? [], [profile]);

  /* 触发器下拉:光标或 profile 变化时,探查是否存在激活触发符 */
  useEffect(() => {
    if (!profile || triggerSpecs.length === 0) {
      setMatches(null);
      setActiveRange(null);
      return;
    }
    const hit = findActiveTrigger(value, cursor, triggerSpecs);
    if (!hit) {
      setMatches(null);
      setActiveRange(null);
      return;
    }
    let cancelled = false;
    const run = () =>
      void lookupSuggestions(profile, hit.spec, value.slice(hit.range[0], hit.range[1])).then(
        (ms) => {
          if (cancelled) return;
          setActiveRange(hit.range);
          setMatches(ms.length ? ms : null);
          setPickIndex(0);
        },
      );
    /* @ 文件触发每键一次 IPC(suggest.ts 侧另有 60s 目录缓存兜底),150ms 防抖合并连续击键;
       / $ 走本地 filter,零 IO,保持即时。 */
    const timer = hit.spec.kind === "file" ? setTimeout(run, 150) : undefined;
    if (timer === undefined) run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, cursor, profile, triggerSpecs]);

  /* 附件 × 移除 → textarea 移除对应 "@path" 文本。
     函数式更新:全部清除等同一批次多次调用时,每次都基于最新 value 计算 ——
     闭包 value 连续 setValue 在 React 批处理下只剩最后一个的旧 bug 不再可能 */
  function removeTokenForAttachment(a: Attachment): void {
    setValue((v) =>
      v
        .replace(ATTACH_TOKEN_RE, (m) => (m.slice(1) === a.path ? "" : m))
        /* 清理连续空白 + 前后空白 */
        .replace(/  +/g, " ")
        .replace(/^\s+|\s+$/g, ""),
    );
  }

  /* textarea 里的 "@path " 文本被删 → MutationObserver 移除 attachment
     但 textarea 是 DOM,内部只是 text node —— MutationObserver 抓不到字符删除;
     改用 keyup/input 比对 tokens 列表 */
  useEffect(() => {
    /* 每次 value 变化时,扫一遍 attachment token 是否还在 */
    const attached = getAttachments();
    if (attached.length === 0) return;
    const existing = new Set(value.match(ATTACH_TOKEN_RE)?.map((t) => t.slice(1)) ?? []);
    attached.forEach((a) => {
      if (!existing.has(a.path)) {
        removeAttachmentByPath(a.path);
      }
    });
  }, [value]);

  function applyPick(match: SuggestionMatch) {
    const range = activeRange;
    if (!range) return;
    const charSpec = triggerSpecs.find((s) =>
      value.slice(range[0], range[0] + 1) === s.char,
    );
    const head = charSpec?.char ?? "";
    const next = value.slice(0, range[0]) + head + match.value + value.slice(range[1]);
    setValue(next);
    setMatches(null);
    setActiveRange(null);
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      const caret = range[0] + head.length + match.value.length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  }

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
    const payload = prepareSendPayload(profile, value);
    const sid = host.getActiveSessionId()!;
    host.writeSession(sid, payload);
    /* 锚点快照信号(checkpoints 消费):仅此处与抽屉发送 emit —— 幕布击键同走 writeSession,不能当 prompt */
    host.events.emit(KernelTopics.promptSent, { sessionId: sid, text: trimmed.slice(0, 400) });
    setValue("");
    clearAttachments();
    setMatches(null);
  }

  /* 拖入或粘贴一个文件 → 写临时文件 + 注册 attachment + textarea 注入 "@path " */
  async function addFiles(fileList: FileList | File[]): Promise<void> {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const remain = MAX_ATTACHMENTS - getAttachments().length;
    if (remain <= 0) {
      /* toast 由调用方处理 */
      return;
    }
    const accepted = files.slice(0, remain);
    /* token 聚合后单次插入:逐个 insertAtCursor 会基于同一次渲染的闭包 value
       连续 setValue,React 批处理下只剩最后一个 @path,其余附件被 token
       同步 effect 静默删除。 */
    const tokens: string[] = [];
    for (const f of accepted) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const path = await ipc.fsWriteTemp(f.name || "attachment", buf);
        const kind = classifyAttachment(f.name, f.type);
        let thumbDataUrl: string | null = null;
        let previewDataUrl: string | null = null;
        if (kind === "image") {
          const thumb = await makeImageThumb(f);
          if (thumb) {
            thumbDataUrl = thumb.thumb;
            previewDataUrl = thumb.full;
          }
        }
        const att = addAttachment({ path, name: f.name, size: f.size, kind, thumbDataUrl, previewDataUrl });
        tokens.push(`@${att.path} `);
      } catch (err) {
        /* 单文件失败不阻塞其余文件,与改造前行为对齐 */
        console.warn("composer: 附件写入失败", f.name, err);
      }
    }
    if (tokens.length > 0 && ref.current) {
      insertAtCursor(ref.current, tokens.join(""));
    }
  }

  function insertAtCursor(ta: HTMLTextAreaElement, insert: string): void {
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + insert + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      ta.focus();
      const caret = start + insert.length;
      ta.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imgItem = items.find((it) => it.type.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    await addFiles([file]);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;

    /* 优先:文件树拖来的项目内文件/文件夹 —— 从 kernel 共享 payload 读 */
    const payload = readDragPayload();
    if (payload) {
      clearDragPayload();
      attachPathReference(payload);
      return;
    }

    /* 外部文件 → 写临时文件 + 引用 */
    const files = Array.from(dt.files);
    if (files.length === 0) return;
    await addFiles(files);
  }

  /* 把项目内路径作为引用 attachment —— 不写临时副本,直接引用原 path */
  function attachPathReference(item: { path: string; isDir: boolean; name: string }): void {
    if (getAttachments().length >= MAX_ATTACHMENTS) return;
    const kind: Attachment["kind"] = item.isDir ? "file" : classifyAttachment(item.name, "");
    const att = addAttachment({
      path: item.path,
      name: item.name,
      size: 0,
      kind,
      thumbDataUrl: null,
      previewDataUrl: null,
    });
    if (ref.current) insertAtCursor(ref.current, `@${att.path} `);
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
        <AttachmentStrip onRemove={removeTokenForAttachment} onPreviewImage={(a) => setPreviewSrc(a.previewDataUrl || a.thumbDataUrl)} />
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
        <textarea
          id="composer-textarea"
          ref={ref}
          value={value}
          placeholder={settings.sendShortcut === "cmdOrCtrlEnter"
            ? "输入消息，⌘/Ctrl+回车发送，回车换行。可用 / 命令 / $ skill / @ 文件引用。拖入文件或 ⌘V 粘贴图片会自动插入引用。"
            : "输入消息，回车发送，Shift+回车换行。可用 / 命令 / $ skill / @ 文件引用。拖入文件或 ⌘V 粘贴图片会自动插入引用。"}
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
              setMatches(null);
              setActiveRange(null);
            }
          }}
          onKeyDown={(e) => {
            /* 判定顺序契约见 openspec design §6:IME → 下拉 → 非空 → 移交。
               IME 组词期全部放行给输入法:↑↓ 属候选窗导航,Enter 属候选上屏,
               此处拦截会把组词文本错替换成下拉首项 */
            const composing = e.nativeEvent.isComposing;
            if (e.key === "ArrowDown" && matches && !composing) {
              e.preventDefault();
              setPickIndex((i) => (matches.length ? (i + 1) % matches.length : 0));
              return;
            }
            if (e.key === "ArrowUp" && matches && !composing) {
              e.preventDefault();
              setPickIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
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
                setMatches(null);
                setActiveRange(null);
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
        {/* 对话锚点栏:右缘 dash 导航,数据/跳转走 kernel messageAnchors */}
        <AnchorRail />
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
        {/* 拖拽悬停遮罩:对齐 composer-design.html 的 .drag-over(accent 内环 + 虚线框 + 提示)。
           pointer-events-none 让 drop 穿透到根容器;inset 顶部留 32px 避开状态栏 */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-(--tmd-bg-elevated)/75">
            <div className="absolute inset-x-2 bottom-2 top-8 rounded-lg border-[1.5px] border-dashed border-(--tmd-accent)" />
            <span className="relative text-xs text-(--tmd-accent)">释放以附加文件 / 图片</span>
          </div>
        )}
      </div>
      {previewSrc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <img src={previewSrc} alt="preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}
