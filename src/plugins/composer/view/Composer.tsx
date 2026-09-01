/**
 * Composer 视图(v1) —— textarea + Enter 发送 / Shift+Enter 换行。
 * Step 4 在此基础上叠加触发器下拉 / 翻译 / 拖拽等增强。
 */

import { useRef } from "react";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { prepareSendPayload } from "../serialize/serialize";

function send(text: string): boolean {
  if (!text.trim()) return false;

  const activeId = host.getActiveSessionId();
  if (!activeId) {
    console.warn("composer: 没有活动会话");
    return false;
  }
  const session = host.getSessions().find((s) => s.id === activeId);
  if (!session) return false;
  const profile = host.getCliProfile(session.profileId);
  if (!profile) return false;

  const payload = prepareSendPayload(profile, text);
  void ipc.sessionWrite(activeId, payload);
  return true;
}

export function Composer() {
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <textarea
        id="composer-textarea"
        ref={ref}
        placeholder="输入消息，回车发送，Shift+回车换行。可用 / 命令 / $ skill / @ 文件引用。"
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const ta = ref.current;
            if (ta && send(ta.value)) ta.value = "";
          }
        }}
      />
    </div>
  );
}
