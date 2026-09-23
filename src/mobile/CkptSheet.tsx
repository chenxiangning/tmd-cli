/**
 * 审批线只读 sheet —— checkpoint_list 批次清单 + 点批展开 checkpoint_batch_diff 统计。
 * 两令均在 AppDevice 白名单(只读);通过/回退仍只在桌面做(白名单写令关闭)。
 * 批次形状 = 线上 JSON(camelCase,铁律 #249);diff 正文不渲染,窄屏只给 +/- 统计。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { invoke } from "@kernel/transport";
import { sortBatches, type CkptLite } from "./shared";

const STATE_CLS: Record<string, string> = {
  pending: "chip",
  approved: "chip g",
  reverted: "chip r",
  done: "chip b",
};

interface PatchLite {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export function CkptSheet(props: { cwd: string; sessionId: string; onClose: () => void }) {
  const [batches, setBatches] = useState<CkptLite[] | null>(null);
  const [err, setErr] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, PatchLite[]>>({});

  const pull = () => {
    setErr(false);
    invoke<CkptLite[]>("checkpoint_list", {
      cwd: props.cwd,
      sessionId: props.sessionId,
      tmdSessionId: props.sessionId,
    })
      .then(setBatches)
      .catch(() => setErr(true));
  };
  useEffect(pull, [props.cwd, props.sessionId]);

  const toggle = (b: CkptLite) => {
    if (openId === b.id) return setOpenId(null);
    setOpenId(b.id);
    if (diffs[b.id]) return;
    invoke<PatchLite[]>("checkpoint_batch_diff", { cwd: props.cwd, batchId: b.id })
      .then((d) => setDiffs((m) => ({ ...m, [b.id]: d })))
      .catch(() => setDiffs((m) => ({ ...m, [b.id]: [] })));
  };

  return (
    <div className="sheet-scrim" onClick={props.onClose}>
      <button
        type="button"
        aria-label={t("关闭")}
        style={{ position: "absolute", inset: 0, cursor: "default", background: "none", border: "none" }}
        onClick={props.onClose}
      />
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">{t("审批线 · {session}", { session: props.sessionId.slice(0, 8) })}</div>
        <div className="sheet-fine">{t("只读摘要 · 处理请在桌面端进行")}</div>
        {err && (
          <div className="m-err" style={{ textAlign: "left" }}>
            {t("读取失败")} <button type="button" className="opt" style={{ flex: "none", padding: "2px 10px" }} onClick={pull}>{t("重试")}</button>
          </div>
        )}
        {!err && batches === null && <div className="sheet-fine">{t("加载中…")}</div>}
        {!err && batches?.length === 0 && <div className="sheet-fine">{t("暂无批次")}</div>}
        {batches && sortBatches(batches).map((b) => (
          <div className="ck-row" key={b.id}>
            <button type="button" className="ck-head" onClick={() => toggle(b)}>
              <span className="ck-idx">#{b.index}</span>
              {b.open ? (
                <span className="chip b">{t("进行中")}</span>
              ) : (
                <span className={STATE_CLS[b.state] ?? "chip"}>{t(b.state === "pending" ? "待审" : b.state === "approved" ? "已通过" : b.state === "reverted" ? "已退" : "已处理")}</span>
              )}
              <span className="ck-p">{b.prompt?.split("\n")[0] || t("(无提示词)")}</span>
              <span className="ck-n">{t("{n} 个文件", { n: b.files.length })}</span>
            </button>
            {openId === b.id && (
              <div className="ck-files">
                {diffs[b.id] === undefined && t("加载中…")}
                {diffs[b.id]?.length === 0 && t("该批无文件记录")}
                {diffs[b.id]?.map((f) => (
                  <div className="ck-file" key={f.path}>
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <span className="ck-stat">
                      {f.binary ? t("二进制") : `+${f.additions}/−${f.deletions}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
