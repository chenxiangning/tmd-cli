/**
 * RPC 输入草稿持久化(从 ssSession 拆出守 300 行铁则)—— tab 关闭/app 重启
 * 不丢(send 成功即清);localStorage key 含引擎+cwd,同引擎不同目录互不串;
 * 隐私模式等存储失效退化为会话内草稿。
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function useSsDraft(profileId: string, cwd: string): [string, Dispatch<SetStateAction<string>>] {
  const [draft, setDraft] = useState(() => {
    try { return localStorage.getItem(`tmd.ss.draft.${profileId}:${cwd}`) ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    try {
      if (draft) localStorage.setItem(`tmd.ss.draft.${profileId}:${cwd}`, draft);
      else localStorage.removeItem(`tmd.ss.draft.${profileId}:${cwd}`);
    } catch { /* 存储失效:草稿退化为会话内 */ }
  }, [draft, profileId, cwd]);
  return [draft, setDraft];
}
