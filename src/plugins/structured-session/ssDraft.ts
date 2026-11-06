/**
 * RPC 输入草稿持久化(从 ssSession 拆出守 300 行铁则)—— tab 关闭/app 重启
 * 不丢(send 成功即清);键 = 存储域 scope(structuredSessionOverlays.ssScope:
 * 引擎+cwd+会话判别后缀),同引擎同 cwd 的并行会话(base + resume)互不串写;
 * resume 域不回落 base(防带入并行会话残留草稿)。隐私模式等存储失效退化为
 * 会话内草稿。
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function useSsDraft(scope: string): [string, Dispatch<SetStateAction<string>>] {
  const key = `tmd.ss.draft.${scope}`;
  const [draft, setDraft] = useState(() => {
    try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    try {
      if (draft) localStorage.setItem(key, draft);
      else localStorage.removeItem(key);
    } catch { /* 存储失效:草稿退化为会话内 */ }
  }, [draft, key]);
  return [draft, setDraft];
}
