/**
 * GitPanel 远端操作编排 —— 对话框开关/远端转圈/通知与执行链
 * (no-high-complexity 降分支):成功/失败都要转满一圈(spinRemainder)再收,
 * 凭据失败引导幕布终端(与右键菜单快速操作同一纪律)。面板组件只留渲染分支。
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { spinRemainder } from "@kernel/spin";
import { ipc, type GitRemoteRequest } from "@kernel/ipc";
import { clearRemoteDialogRequest, useGitPanelState } from "./panelStore";
import { gitErrorDisplay, isAuth } from "./gitError";

export function useGitPanelRemote(cwd: string | null, afterMutation: () => void) {
  const { remoteDialogRequest } = useGitPanelState();
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState<"push" | "pull" | "fetch" | null>(null);
  const [dialog, setDialog] = useState<GitRemoteRequest["op"] | null>(null);

  /* 分支右键菜单「推送...」等入口请求打开远端对话框:消费即清,nonce 防重复。 */
  useEffect(() => {
    if (!remoteDialogRequest) return;
    clearRemoteDialogRequest();
    setDialog(remoteDialogRequest.op);
  }, [remoteDialogRequest]);

  /** 对话框执行链:关对话框 → 顶栏按钮转圈 → 成功通知+全量刷新 / 失败通知。 */
  const runDialog = useCallback(
    (op: GitRemoteRequest["op"], req: GitRemoteRequest, opLabel: string) => {
      if (!cwd || remoteBusy) return;
      setDialog(null);
      setRemoteBusy(op);
      setNotice(null);
      /* 转圈兜底:数据再快也转满一圈(kernel/spin),否则用户以为没点上。 */
      const startedAt = Date.now();
      const finishSpin = () => setRemoteBusy(null);
      ipc.gitRemoteRequest(cwd, req).then(
        () => {
          const wait = spinRemainder(startedAt);
          if (wait > 0) setTimeout(finishSpin, wait);
          else finishSpin();
          setNotice(t("{op}成功。", { op: opLabel }));
          afterMutation();
        },
        (e: unknown) => {
          const wait = spinRemainder(startedAt);
          if (wait > 0) setTimeout(finishSpin, wait);
          else finishSpin();
          setNotice(
            isAuth(e)
              ? t("{op}失败:凭据需要交互,请到幕布终端执行 git {cmd}", { op: opLabel, cmd: op })
              : t("{op}失败。 {err} 可重试该操作。", { op: opLabel, err: gitErrorDisplay(e) }),
          );
        },
      );
    },
    [cwd, remoteBusy, afterMutation],
  );

  return { dialog, setDialog, remoteBusy, notice, setNotice, runDialog };
}
