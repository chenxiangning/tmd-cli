/**
 * Composer 触发器下拉 hook —— 自 Composer.tsx 拆出(文件规模铁则)。
 *
 * 光标或 profile 变化时探查激活触发符;@ 走全仓索引缓存(Rust walk + 60s TTL),
 * / $ 走 listSuggestions 适配层缓存(omp/pi RPC 5min TTL);150ms 防抖合并连续击键。
 * SSH 会话显式不激活 @ 文件触发(远端列举不在本通道)。
 * ext 触发源(kernel composerExt,CLI 无关,如 assets !! ##)与 profile 触发符合并;
 * wakeTrigger 供右缘唤醒图标注入触发符并自动弹候选,未选中关闭时回收(dismiss)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CliProfile } from "@kernel/cli";
import { composerTriggerSources } from "@kernel/composerExt";
import { host } from "@kernel/host";
import { findActiveTrigger } from "../serialize/serialize";
import type { SuggestionMatch } from "../triggers/suggest";
import { lookupSuggestions } from "../triggers/suggest";

export function useComposerTriggers({
  profile,
  value,
  cursor,
  cwd,
  textareaRef,
  setValue,
  setCursor,
}: {
  profile: CliProfile | null;
  value: string;
  cursor: number;
  cwd: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
}) {
  const triggerSpecs = useMemo(
    () => [...(profile?.triggers ?? []), ...composerTriggerSources()],
    [profile],
  );
  /* 唤醒图标自动插入的触发符快照:未选中且一字未改时 dismiss 回收 */
  const autoInserted = useRef<{ before: string; after: string; caret: number } | null>(null);
  const [matches, setMatches] = useState<SuggestionMatch[] | null>(null);
  const [activeRange, setActiveRange] = useState<[number, number] | null>(null);
  const [pickIndex, setPickIndex] = useState(0);

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
    /* @ 文件索引只覆盖本地 fs;SSH 会话显式不激活(远端列举不在本通道) */
    const activeSessionKind = host.getSessions().find(
      (s) => s.id === host.getActiveSessionId(),
    )?.kind;
    if ("kind" in hit.spec && hit.spec.kind === "file" && activeSessionKind === "ssh") {
      setMatches(null);
      setActiveRange(null);
      return;
    }
    let cancelled = false;
    const run = () =>
      void lookupSuggestions(profile, hit.spec, value.slice(hit.range[0], hit.range[1]), cwd).then(
        (ms) => {
          if (cancelled) return;
          setActiveRange(hit.range);
          setMatches(ms.length ? ms : null);
          setPickIndex(0);
        },
      );
    /* @ 走全仓索引缓存(Rust walk + 60s TTL),/ $ 走 listSuggestions 适配层缓存
       (omp/pi RPC 5min TTL);150ms 防抖合并连续击键。 */
    const timer = setTimeout(run, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, cursor, profile, triggerSpecs, cwd]);

  function applyPick(match: SuggestionMatch) {
    const range = activeRange;
    if (!range) return;
    const spec = triggerSpecs.find((s) => value.startsWith(s.char, range[0]));
    const replacement = match.insertText ?? (spec?.char ?? "") + match.value;
    const next = value.slice(0, range[0]) + replacement + value.slice(range[1]);
    autoInserted.current = null;
    setValue(next);
    setMatches(null);
    setActiveRange(null);
    match.onPick?.(host.getActiveSessionId());
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = range[0] + replacement.length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  }

  /** 右缘唤醒图标入口:光标处注入触发符并聚焦,候选面板经既有探查自动弹出。 */
  function wakeTrigger(char: string) {
    const at = textareaRef.current?.selectionStart ?? value.length;
    const after = value.slice(0, at) + char + value.slice(at);
    autoInserted.current = { before: value, after, caret: at };
    setValue(after);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = at + char.length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  }

  /** 关闭候选面板(Esc / 失焦):唤醒注入的触发符未被消费且一字未改 → 回收。 */
  function dismiss() {
    const auto = autoInserted.current;
    autoInserted.current = null;
    setMatches(null);
    setActiveRange(null);
    if (!auto || value !== auto.after) return;
    setValue(auto.before);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(auto.caret, auto.caret);
      setCursor(auto.caret);
    });
  }

  return {
    triggerSpecs,
    matches,
    activeRange,
    pickIndex,
    setPickIndex,
    setMatches,
    setActiveRange,
    applyPick,
    wakeTrigger,
    dismiss,
  };
}
