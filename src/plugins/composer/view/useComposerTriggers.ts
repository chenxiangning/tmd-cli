/**
 * Composer 触发器下拉 hook —— 自 Composer.tsx 拆出(文件规模铁则)。
 *
 * 光标或 profile 变化时探查激活触发符;@ 走全仓索引缓存(Rust walk + 60s TTL),
 * / $ 走 listSuggestions 适配层缓存(omp/pi RPC 5min TTL);150ms 防抖合并连续击键。
 * SSH 会话显式不激活 @ 文件触发(远端列举不在本通道)。
 */

import { useEffect, useMemo, useState } from "react";
import type { CliProfile } from "@kernel/cli";
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
  const triggerSpecs = useMemo(() => profile?.triggers ?? [], [profile]);
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
    if (hit.spec.kind === "file" && activeSessionKind === "ssh") {
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
    const charSpec = triggerSpecs.find((s) =>
      value.slice(range[0], range[0] + 1) === s.char,
    );
    const head = charSpec?.char ?? "";
    const next = value.slice(0, range[0]) + head + match.value + value.slice(range[1]);
    setValue(next);
    setMatches(null);
    setActiveRange(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const caret = range[0] + head.length + match.value.length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      setCursor(caret);
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
  };
}
