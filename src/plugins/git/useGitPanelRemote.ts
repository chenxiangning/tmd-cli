/**
 * GitPanel 远端操作编排 —— 对话框开关/远端转圈/通知与执行链
 * (no-high-complexity 降分支):成功/失败都要转满一圈(spinRemainder)再收,
 * 凭据失败引导幕布终端(与右键菜单快速操作同一纪律)。面板组件只留渲染分支。
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { spinRemainder } from "@kernel/spin";
import { ipc, type GitRemoteRequest } from "@kernel/ipc";
import { clearRemoteDialogRequest, useGitPanelState, type RemoteDialogOp } from "./panelStore";
import { gitErrorDisplay, isAuth } from "./gitError";
import { formatRemoteReport } from "./views/remoteDialogs/remoteReport";

export function useGitPanelRemote(cwd: string | null, afterMutation: () => void) {
  const { remoteDialogRequest } = useGitPanelState();
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState<"push" | "pull" | "fetch" | null>(null);
  const [dialog, setDialogState] = useState<RemoteDialogOp | null>(null);
  /* 推送回执:推送弹窗点击后不再即关,进行中/结果留在弹窗底栏;开关弹窗即清。 */
  const [pushOutcome, setPushOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const setDialog = useCallback((op: RemoteDialogOp | null) => {
    setPushOutcome(null);
    setDialogState(op);
  }, []);

  /* 分支右键菜单「推送...」等入口请求打开远端对话框:消费即清,nonce 防重复。 */
  useEffect(() => {
    if (!remoteDialogRequest) return;
    clearRemoteDialogRequest();
    setDialog(remoteDialogRequest.op);
  }, [remoteDialogRequest, setDialog]);

  /** 对话框执行链:推送保留弹窗(底栏呈现进度/结果,可假关闭后台跑),拉取/获取维持即关;
   *  busy 态 → 成功通知+全量刷新 / 失败通知。 */
  const runDialog = useCallback(
    (op: GitRemoteRequest["op"], req: GitRemoteRequest, opLabel: string) => {
      if (!cwd || remoteBusy) return;
      if (op !== "push") setDialog(null);
      setPushOutcome(null);
      setRemoteBusy(op);
      setNotice(null);
      /* 转圈兜底:数据再快也转满一圈(kernel/spin),否则用户以为没点上。 */
      const startedAt = Date.now();
      const finishSpin = () => setRemoteBusy(null);
      const settle = () => {
        const wait = spinRemainder(startedAt);
        if (wait > 0) setTimeout(finishSpin, wait);
        else finishSpin();
      };
      ipc.gitRemoteRequest(cwd, req).then(
        (report) => {
          const text = formatRemoteReport(op, opLabel, report);
          settle();
          setNotice(text);
          if (op === "push") setPushOutcome({ ok: true, text });
          afterMutation();
        },
        (e: unknown) => {
          const text = isAuth(e)
            ? t("{op}失败:凭据需要交互,请到幕布终端执行 git {cmd}", { op: opLabel, cmd: op })
            : t("{op}失败。 {err} 可重试该操作。", { op: opLabel, err: gitErrorDisplay(e) });
          settle();
          setNotice(text);
          if (op === "push") setPushOutcome({ ok: false, text });
        },
      );
    },
    [cwd, remoteBusy, afterMutation, setDialog],
  );

  return { dialog, setDialog, remoteBusy, notice, setNotice, runDialog, pushOutcome };
}
