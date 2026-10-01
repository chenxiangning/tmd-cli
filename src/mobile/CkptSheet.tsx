/**
 * 审批线只读 sheet —— checkpoint_list 批次清单 + 点批展开 checkpoint_batch_diff 统计。
 * 两令均在 AppDevice 白名单(只读);通过/回退仍只在桌面做(白名单写令关闭)。
 * 批次形状 = 线上 JSON(camelCase,铁律 #249);diff 正文不渲染,窄屏只给 +/- 统计。
 * 基座 = SheetBase(焦点进出 + 遮罩命中);批次 diff 三态(失败与空表分离,可重试)。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { invoke } from "@kernel/transport";
import { sortBatches, type CkptLite } from "./shared";
import { SheetBase } from "./SheetBase";

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

/** 批次 diff 三态(对齐 gitModel 模式):error 不再伪装成空表。 */
type DiffState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; files: PatchLite[] };

/** 批次 diff 三态渲染:加载中 / 失败重试 / 空表 / 清单。 */
function BatchDiff(props: { state: DiffState | undefined; onRetry: () => void }) {
  const s = props.state ?? { kind: "loading" };
  return (
    <div className="ck-files">
      {s.kind === "loading" && t("加载中…")}
      {s.kind === "error" && (
        <>
          {t("读取失败")} <button type="button" className="lnk-btn" onClick={props.onRetry}>{t("重试")}</button>
        </>
      )}
      {s.kind === "done" && s.files.length === 0 && t("该批无文件记录")}
      {s.kind === "done" && s.files.map((f) => (
        <div className="ck-file" key={f.path}>
          <span className="fx-ellip">{f.path}</span>
          <span className="ck-stat">
            {f.binary ? t("二进制") : `+${f.additions}/−${f.deletions}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CkptSheet(props: { cwd: string; sessionId: string; onClose: () => void }) {
  const [batches, setBatches] = useState<CkptLite[] | null>(null);
  const [err, setErr] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});

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

  const pullDiff = (id: string) => {
    setDiffs((m) => ({ ...m, [id]: { kind: "loading" } }));
    invoke<PatchLite[]>("checkpoint_batch_diff", { cwd: props.cwd, batchId: id })
      .then((d) => setDiffs((m) => ({ ...m, [id]: { kind: "done", files: d } })))
      .catch(() => setDiffs((m) => ({ ...m, [id]: { kind: "error" } })));
  };

  const toggle = (b: CkptLite) => {
    if (openId === b.id) return setOpenId(null);
    setOpenId(b.id);
    if (!diffs[b.id]) pullDiff(b.id);
  };

  return (
    <SheetBase
      onClose={props.onClose}
      label={t("审批线 · {session}", { session: props.sessionId.slice(0, 8) })}
    >
      <div className="sheet-h">{t("审批线 · {session}", { session: props.sessionId.slice(0, 8) })}</div>
      <div className="sheet-fine">{t("只读摘要 · 处理请在桌面端进行")}</div>
      {err && (
        <div className="m-err" style={{ textAlign: "left" }}>
          {t("读取失败")} <button type="button" className="lnk-btn" onClick={pull}>{t("重试")}</button>
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
          {openId === b.id && <BatchDiff state={diffs[b.id]} onRetry={() => pullDiff(b.id)} />}
        </div>
      ))}
    </SheetBase>
  );
}
