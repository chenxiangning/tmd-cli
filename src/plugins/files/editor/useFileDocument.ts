/**
 * 文件文档状态钩子 —— 编辑内容 / 脏标记 / 保存,复刻 codemoss useFileDocumentState:
 *
 * - 初始内容 = 磁盘内容(\r\n 归一),若有未保存草稿则草稿优先(关脏 tab 重开恢复)。
 * - dirty = content !== saved,变化时经 updateTab 同步到 tab 栏圆点。
 * - 保存:写回磁盘(CRLF 还原)→ 刷内容缓存 → 清草稿;失败信息落 footer。
 * - 外部变更防护(乐观锁):打开时取磁盘 mtime 基线,保存带 expectMtime;
 *   AI 会话/终端在保存前改了磁盘 → Rust 拒写回 E_FS_MTIME,此处置 conflict,
 *   由用户裁决覆盖(forceSave)或重载(reloadFromDisk),不再静默 clobber。
 * - 保存触发:files.save(⌘S)命令经模块级 saveRequestRef 桥进来,活动 tab 即保存目标。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@kernel/ipc";
import { updateTab } from "@kernel/tabs";
import { findRemoteFileSourceForUri, isRemoteFileUri } from "@kernel/fileSources";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { draftMirrorClear, draftMirrorGet, type DraftMirrorEntry } from "@kernel/draftMirror";
import {
  cacheRefreshContent,
  draftDelete,
  draftGet,
  draftSet,
  toDiskContent,
  toEditorContent,
} from "./fileCache";

/** files.save 命令桥:挂载中的文件编辑器实例经此接收保存触发(先例 TerminalView.findRequestRef)。 */
export const saveRequestRef: { current: (() => void) | null } = { current: null };

export interface FileDocState {
  content: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** 磁盘外变自增(重读正文时 +1):行级 diff 着色的重拉信号。 */
  diskTick: number;
  /** 磁盘外部变更冲突:保存被乐观锁拦截,等用户裁决(覆盖/重载)。 */
  conflict: boolean;
  setDoc: (value: string) => void;
  save: () => void;
  /** 冲突裁决 A:覆盖磁盘(丢外部版本)。 */
  forceSave: () => void;
  /** 冲突裁决 B:重读磁盘(丢本地草稿)。 */
  reloadFromDisk: () => void;
  /** 跨崩溃/强退的草稿镜像(无 = 不出恢复条);恢复/丢弃语义见下。 */
  mirror: DraftMirrorEntry | null;
  restoreMirror: () => void;
  dismissMirror: () => void;
}

export function useFileDocument(path: string, diskContent: string): FileDocState {
  /* 初始化包(stable):归一态磁盘文本 + 是否 CRLF;草稿优先。 */
  const [init] = useState(() => {
    const { text, hasCRLF } = toEditorContent(diskContent);
    const draft = draftGet(path);
    return { saved: text, hasCRLF, initial: draft ?? text };
  });
  const [content, setContent] = useState(init.initial);
  const [saved, setSaved] = useState(init.saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 磁盘外变自增:行级 diff 着色以此感知「正文已重读」,否则旧 patch 标记挂在
   * 重读后的文档上(2026-10-09 评审 P2)。 */
  const [diskTick, setDiskTick] = useState(0);
  const [conflict, setConflict] = useState(false);

  /* 行尾标记放 ref:磁盘内容外变(刷新重读)时随新内容更新,保存还原才不会用旧行尾。 */
  const hasCRLFRef = useRef(init.hasCRLF);

  const dirty = content !== saved;

  const contentRef = useRef(content);
  const savedRef = useRef(saved);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  /* mtime 基线:打开时取一次;保存成功滚动为写后值;干净态外变跟进时刷新。
   * 多 CLI 宿主里 AI 天天改文件,这是「⌘S 静默覆盖并发写」的唯一防线。 */
  const mtimeRef = useRef<number | null>(null);
  /* ref 镜像在 effect 内同步(渲染期写 ref 违反 React 渲染纯性,react-doctor 强报)。 */
  useEffect(() => {
    contentRef.current = content;
    savedRef.current = saved;
  }, [content, saved]);

  /* 打开取基线(延迟半拍无碍:首保存前完成的取数都赶在用户输入之后)。 */
  useEffect(() => {
    mtimeRef.current = null;
    conflictRef.current = false;
    setConflict(false);
    let alive = true;
    if (!isRemoteFileUri(path)) {
      void ipc.fsMtime(path).then((m) => {
        if (alive) mtimeRef.current = m;
      });
    }
    return () => {
      alive = false;
    };
  }, [path]);

  /* 磁盘内容外变(刷新按钮 reloadFile 重读):无未保存草稿时静默跟进新内容;
     有草稿则以编辑态为准,不覆盖用户输入。行尾标记同步更新;干净态跟进
     后磁盘已换版本,基线随之刷新(否则下次保存误报冲突)。 */
  useEffect(() => {
    if (savedRef.current !== contentRef.current) return;
    const { text, hasCRLF } = toEditorContent(diskContent);
    hasCRLFRef.current = hasCRLF;
    if (text === savedRef.current) return;
    setSaved(text);
    setContent(text);
    setDiskTick((v) => v + 1);
    void ipc.fsMtime(path).then((m) => {
      mtimeRef.current = m;
    });
  }, [diskContent, path]);

  const setDoc = useCallback(
    (value: string) => {
      setContent(value);
      if (value === savedRef.current) draftDelete(path);
      else draftSet(path, value);
    },
    [path],
  );

  const save = useCallback(
    (force: boolean) => () => {
      if (savingRef.current) return;
      if (isRemoteFileUri(path)) {
        /* 远程写回(项 5):源声明 writeText 才可用(未声明源保持 M1 提示);
         * 远程无 mtime 基线,乐观锁不适用,直写。 */
        const source = findRemoteFileSourceForUri(path);
        if (!source?.writeText) {
          setError(t("远程文件暂不支持写入(M1)"));
          return;
        }
        const text = contentRef.current;
        if (text === savedRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError(null);
        source
          .writeText(path, toDiskContent(text, hasCRLFRef.current))
          .then(() => {
            savingRef.current = false;
            setSaving(false);
            setSaved(text);
            draftDelete(path);
          })
          .catch((e: unknown) => {
            savingRef.current = false;
            setSaving(false);
            setError(errTextDisplay(e));
          });
        return;
      }
      const text = contentRef.current;
      if (text === savedRef.current && !conflictRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setError(null);
      const disk = toDiskContent(text, hasCRLFRef.current);
      /* force = 冲突裁决后的覆盖写;平时带基线做乐观锁。 */
      const expect = force ? undefined : mtimeRef.current;
      ipc.fsWriteFile(path, disk, expect).then(
        (after) => {
          savingRef.current = false;
          setSaving(false);
          setSaved(text);
          mtimeRef.current = after;
          conflictRef.current = false;
          setConflict(false);
          /* 内容缓存原地刷新:预览/重开编辑器立即读到新值,不再走磁盘 IO */
          cacheRefreshContent(path, disk);
          draftDelete(path);
        },
        (e) => {
          savingRef.current = false;
          setSaving(false);
          const msg = String(e);
          if (msg.includes("E_FS_MTIME")) {
            conflictRef.current = true;
            setConflict(true);
            setError(null);
          } else {
            setError(msg);
          }
        },
      );
    },
    [path],
  );

  /* 冲突裁决 B:重读磁盘版本,本地草稿丢弃(需用户点按钮,不做静默切换)。 */
  const reloadFromDisk = useCallback(() => {
    if (isRemoteFileUri(path)) return;
    void ipc.fsReadFile(path).then((raw) => {
      const { text, hasCRLF } = toEditorContent(raw);
      hasCRLFRef.current = hasCRLF;
      mtimeRef.current = null;
      conflictRef.current = false;
      setConflict(false);
      setError(null);
      setSaved(text);
      setContent(text);
      setDiskTick((v) => v + 1);
      draftDelete(path);
      cacheRefreshContent(path, raw);
      void ipc.fsMtime(path).then((m) => {
        mtimeRef.current = m;
      });
    });
  }, [path]);

  /* 保存请求桥:⌘S 命令(files.save)注册口经此触发最新 save;卸载即摘除,
     非文件 tab 下 when 不满足,键穿透。 */
  const saveRef = useRef(save(false));
  useEffect(() => {
    saveRef.current = save(false);
    saveRequestRef.current = () => saveRef.current();
    return () => {
      saveRequestRef.current = null;
    };
  }, [save]);

  /* 脏标记同步到 tab(圆点)。卸载不清理:切走的脏 tab 仍需保持圆点。 */
  useEffect(() => {
    updateTab(`file:${path}`, { dirty });
  }, [path, dirty]);

  /* 草稿镜像恢复条(0.4.0 项 12):内存草稿在场 = 本运行内的关脏重开,编辑
   * 态已是草稿本体,不弹条;镜像条只服务跨崩溃/强退(内存草稿已随进程蒸发)
   * 的场景,且镜像与磁盘内容有差才有恢复价值。 */
  const [mirror, setMirror] = useState<DraftMirrorEntry | null>(() => {
    if (draftGet(path) !== undefined) return null;
    const m = draftMirrorGet(`file:${path}`);
    return m && m.text !== init.saved ? m : null;
  });
  const restoreMirror = useCallback(() => {
    if (!mirror) return;
    setDoc(mirror.text); /* 写回编辑器并置脏(draftSet/镜像在 setDoc 续写) */
    setMirror(null);
  }, [mirror, setDoc]);
  const dismissMirror = useCallback(() => {
    draftMirrorClear(`file:${path}`);
    setMirror(null);
  }, [path]);

  return {
    content,
    dirty,
    saving,
    error,
    diskTick,
    conflict,
    setDoc,
    save: save(false),
    forceSave: save(true),
    reloadFromDisk,
    mirror,
    restoreMirror,
    dismissMirror,
  };
}
