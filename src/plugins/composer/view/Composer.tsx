/**
 * Composer 视图 —— textarea + 触发器下拉 + 翻译 → PTY。
 *
 * 行为:
 * - Enter 发送 / Shift+Enter 换行
 * - 触发符(由当前会话 cli profile 声明)在光标前识别后,弹下拉
 *   - 候选来自:
 *     @ fsListDir(file 触发)
 *     / profile.suggestions.command
 *     $ profile.suggestions.skill
 *   - 候选面板支持 ↑↓/Enter/Tab/Esc 选中,选中替换触发器 + token
 * - 发送时把命中 "$token" → translate("/skill:token")(omp/pi 已声明)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { findActiveTrigger, prepareSendPayload } from "../serialize/serialize";
import type { SuggestionMatch } from "../triggers/suggest";
import { lookupSuggestions } from "../triggers/suggest";
import { SuggestionList } from "./SuggestionList";
import { useActiveProfile } from "../state/useActiveProfile";

export function Composer() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [matches, setMatches] = useState<SuggestionMatch[] | null>(null);
  const [activeRange, setActiveRange] = useState<[number, number] | null>(null);
  const [pickIndex, setPickIndex] = useState(0);
  const profile = useActiveProfile();

  const triggerSpecs = useMemo(() => profile?.triggers ?? [], [profile]);

  // 光标或 profile 变化时,探查是否存在激活触发符;若有,拉候选。
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
    void lookupSuggestions(profile, hit.spec, value.slice(hit.range[0], hit.range[1])).then(
      (ms) => {
        if (cancelled) return;
        setActiveRange(hit.range);
        setMatches(ms.length ? ms : null);
        setPickIndex(0);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [value, cursor, profile, triggerSpecs]);

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
    // 光标移到插入末尾
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
    const payload = prepareSendPayload(profile, value);
    void ipc.sessionWrite(host.getActiveSessionId()!, payload);
    setValue("");
    setMatches(null);
  }

  return (
    <div className="relative flex h-full flex-col bg-neutral-900">
      {matches && activeRange && (
        <SuggestionList
          matches={matches}
          pickIndex={pickIndex}
          onPick={applyPick}
          onHoverIndex={setPickIndex}
        />
      )}
      <textarea
        id="composer-textarea"
        ref={ref}
        value={value}
        placeholder="输入消息，回车发送，Shift+回车换行。可用 / 命令 / $ skill / @ 文件引用。"
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
        onChange={(e) => {
          setValue(e.target.value);
          setCursor(e.target.selectionStart);
        }}
        onSelect={(e) => {
          const t = e.currentTarget;
          setCursor(t.selectionStart);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && matches) {
            e.preventDefault();
            setPickIndex((i) => (matches.length ? (i + 1) % matches.length : 0));
            return;
          }
          if (e.key === "ArrowUp" && matches) {
            e.preventDefault();
            setPickIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
            return;
          }
          if (matches) {
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
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            sendCurrent();
          }
        }}
      />
    </div>
  );
}
