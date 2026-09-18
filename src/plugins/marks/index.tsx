/**
 * marks 插件 —— 文件阅读标记:行间锚点(CodeMirror 装饰)+ 全局标记中心(右栏
 * 面板,跨文件聚合)+ 发送引用(composer 变换自动尾拼 pending 标记)+ 终端回链
 * (path:Lx-Ly 点击定位)。
 *
 * 设计 spec:docs/superpowers/specs/2026-09-18-file-marks-design.md
 * 0 容忍红线:源文件零写入;标记存 sidecar ~/.tmd-cli/marks/<dirKey(cwd)>.json。
 */

import { BookmarkSimple } from "@phosphor-icons/react";
import { registerComposerSendTransform } from "@kernel/composerExt";
import { ipc } from "@kernel/ipc";
import { ensurePanelPinned } from "@kernel/filePanel";
import { t } from "@kernel/i18n";
import type { Plugin } from "@kernel/plugin";
import { getActiveWorkspace } from "@kernel/workspace";
import { MarksPanel } from "./panel";
import { addMark, loadAllMarks, marksSnapshot, removeMark, setMarkState, subscribeMarks, updateNote } from "./store";
import { marksSendTransform } from "./sendTransform";
import { MarksComposerChips } from "./chips";
import { marksLinkProvider } from "./terminalLink";
import { marksEditorExtension } from "./editorExtension";

/** 事件载荷(files/markBridge.ts 契约的 marks 侧副本,字段必须同步)。 */
interface FileMarkRequest {
  path: string;
  startLine: number;
  endLine: number;
}
type FileMarkLite = { id: string; startLine: number; endLine: number; note: string; state: string };
type FileMarkMap = Record<string, FileMarkLite[] | undefined>;
/** 预览卡片动作(remove/stage/note)。 */
interface FileMarkAction {
  id: string;
  op: "remove" | "stage" | "note";
  note?: string;
}

/** 预览落锚:读文件内容做指纹(marks 侧持有锚定知识,预览只报行号)。 */
async function handleMarkRequest(req: FileMarkRequest): Promise<void> {
  const cwd = getActiveWorkspace()?.root;
  if (!cwd) return;
  const content = await ipc.fsReadFile(req.path).catch(() => "");
  if (!content) return;
  addMark({
    cwd,
    path: req.path,
    startLine: req.startLine,
    endLine: req.endLine,
    lines: content.split("\n"),
  });
}

/** 全量轻量快照(按绝对 path 分组),供预览渲染已标记块。 */
function liteMarkMap(): FileMarkMap {
  const snap = marksSnapshot();
  const out: FileMarkMap = {};
  for (const marks of Object.values(snap.byCwd)) {
    for (const mark of marks) {
      (out[mark.path] ??= []).push({
        id: mark.id,
        startLine: mark.startLine,
        endLine: mark.endLine,
        note: mark.note,
        state: mark.state,
      });
    }
  }
  return out;
}

export const marksPlugin: Plugin = {
  id: "marks",
  meta: {
    name: t("文件标记"),
    abbr: "标记",
    desc: t("文件阅读标记:行间锚点、跨文件汇总,发送自动带引用,终端回链定位"),
    icon: BookmarkSimple,
    iconColor: "#EAB308",
    category: "feature",
  },
  permissions: ["ipc.fs.read", "ipc.fs.write", "events"],
  activate(ctx) {
    ctx.registerFilePanel({
      id: "marks",
      label: t("标记"),
      icon: BookmarkSimple,
      component: MarksPanel,
      showFileSubbar: false,
      pinnedByDefault: true,
    });
    /* 老用户 persisted 钉住清单里没有 marks,会落 ⋯ 溢出菜单不可见 —— 一次性补钉 */
    ensurePanelPinned("marks");
    ctx.contribute("composer.attachments", { component: MarksComposerChips });
    const offs = [
      ctx.registerEditorExtension(marksEditorExtension),
      ctx.registerTerminalLinkProvider(marksLinkProvider),
      registerComposerSendTransform(marksSendTransform),
    ];
    /* md 预览(files 插件)经事件总线落锚:插件间零 import,双端各自声明载荷 */
    offs.push(
      ctx.events.on<FileMarkRequest>("file-mark:request", (req) => {
        void handleMarkRequest(req);
      }),
      ctx.events.on<FileMarkAction>("file-mark:action", (action) => {
        const cwd = getActiveWorkspace()?.root;
        if (!cwd) return;
        if (action.op === "remove") removeMark(cwd, action.id);
        else if (action.op === "stage") setMarkState(cwd, action.id, "staged");
        else if (action.op === "note" && action.note !== undefined) updateNote(cwd, action.id, action.note);
      }),
    );
    const emitChanged = () => ctx.events.emit<FileMarkMap>("file-mark:changed", liteMarkMap());
    offs.push(subscribeMarks(emitChanged));
    void loadAllMarks().then(emitChanged).catch(() => undefined);
    /* 反注册钩先设:下方注册中途抛错也不留半注册状态(assets 同款) */
    this.deactivate = () => {
      for (const off of offs) off();
    };
  },
};
