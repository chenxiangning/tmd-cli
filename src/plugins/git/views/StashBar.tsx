/**
 * GitStashBar —— stash 管理面条(0.4.5,此前 stash 仅「暂存并切换」内部使用)。
 * 无 stash 且工作区干净时零占位;有 stash 出一条细横条(消息 + 时间 + 应用/弹出/丢弃),
 * 展开/收起经 aria-expanded;丢弃走 GitConfirmDialog 确认(不可逆)。
 * 「+ stash」手动创建(0.4.5):工作区脏即可见(空表也出条),点开小输入,
 * 消息可选(空 = 默认文案);智能切换的自动 stash 链不动。
 * 弹出 = apply+drop(冲突保留不丢,Rust 侧同智能切换 restore 律);列表
 * 自管生命周期:挂载拉取 + 动作后重拉,afterMutation 通知面板刷工作区。
 */
import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { formatAbsolute } from "@kernel/relativeTime";
import { ipc } from "@kernel/ipc";
import type { GitStashEntry } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";
import { GitConfirmDialog, type GitConfirmState } from "./GitConfirmDialog";

export function GitStashBar({
  cwd,
  dirty,
  onNotice,
  afterMutation,
}: {
  cwd: string;
  /** 工作区脏(files 非空):空 stash 表也出条(「+ stash」可达);干净且空零占位。 */
  dirty: boolean;
  onNotice: (msg: string) => void;
  afterMutation: () => void;
}) {
  const [entries, setEntries] = useState<GitStashEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [dropConfirm, setDropConfirm] = useState<GitConfirmState | null>(null);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  /* 动作目标条目:仅 handler 内消费(不参与渲染),用 ref 不引重渲。 */
  const pendingIndexRef = useRef<number | null>(null);

  const reload = () => {
    ipc.gitStashList(cwd).then(setEntries, () => setEntries(null));
  };
  useEffect(reload, [cwd]);

  /* 空表且工作区干净零占位(读取失败静默:面板主视图不受影响,下次挂载重试)。
     早退在全部钩子之后,守 Rules of Hooks。 */
  if (!entries || (entries.length === 0 && !dirty)) return null;

  const act = (label: string, run: () => Promise<void>) => {
    const index = pendingIndexRef.current;
    if (index === null) return;
    setBusy(index);
    run().then(
      () => {
        onNotice(label);
        reload();
        afterMutation();
        setBusy(null);
      },
      (e: unknown) => {
        onNotice(gitErrorDisplay(e));
        reload();
        setBusy(null);
      },
    );
  };

  /* 「+ stash」提交:消息可选(空 = Rust 侧默认文案);created=false = 工作区干净。 */
  const submitCreate = () => {
    if (busy !== null) return;
    setBusy(-1);
    ipc.gitStashCreate(cwd, createMsg).then(
      (created) => {
        onNotice(created ? t("已创建 stash") : t("工作区干净,没有可暂存的改动"));
        setCreating(false);
        setCreateMsg("");
        reload();
        afterMutation();
        setBusy(null);
      },
      (e: unknown) => {
        onNotice(gitErrorDisplay(e));
        reload();
        setBusy(null);
      },
    );
  };

  return (
    <div className="flex shrink-0 flex-col border-b border-(--tmd-border) bg-(--tmd-bg-sunken)">
      <div className="flex items-center gap-1 px-2 py-1">
        {entries.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          >
            {open ? (
              <CaretDown size="0.75rem" aria-hidden />
            ) : (
              <CaretRight size="0.75rem" aria-hidden />
            )}
            <span className="font-medium">
              {t("Stash ({n})", { n: String(entries.length) })}
            </span>
            <span className="min-w-0 flex-1 truncate text-(--tmd-fg-faint)">
              {open ? "" : entries[0].message}
            </span>
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null}
          title={t("把当前改动存入 stash(消息可选)")}
          onClick={() => setCreating((v) => !v)}
          className={`shrink-0 rounded border border-(--tmd-border) px-1.5 py-0.5 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-50 ${
            entries.length === 0 ? "" : "ml-auto"
          }`}
        >
          {t("+ stash")}
        </button>
      </div>
      {creating && (
        <div className="flex items-center gap-1.5 px-2 pb-1">
          <input
            value={createMsg}
            autoFocus
            spellCheck={false}
            disabled={busy !== null}
            placeholder={t("stash 消息(可选),留空 = 默认")}
            aria-label={t("stash 消息(可选),留空 = 默认")}
            onChange={(e) => setCreateMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setCreating(false);
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submitCreate();
            }}
            className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-(--tmd-bg) px-1.5 py-0.5 text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={submitCreate}
            className="shrink-0 rounded border border-(--tmd-border) px-1.5 py-0.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
          >
            {t("存入 stash")}
          </button>
        </div>
      )}
      {open && (
        <div className="max-h-44 overflow-y-auto px-2 pb-1">
          {entries.map((e) => (
            <div
              key={e.index}
              className="flex items-center gap-2 py-0.5 text-xs"
            >
              <span className="shrink-0 font-mono text-[10px] text-(--tmd-fg-faint)">
                #{e.index}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-(--tmd-accent)">
                {e.shortSha}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-(--tmd-fg-muted)"
                title={e.message}
              >
                {e.message}
              </span>
              <span className="shrink-0 text-[10px] text-(--tmd-fg-faint)">
                {formatAbsolute(e.when * 1000)}
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  pendingIndexRef.current = e.index;
                  act(
                    t("已套用 stash #{n}(条目保留)", { n: String(e.index) }),
                    () => ipc.gitStashApply(cwd, e.index, true),
                  );
                }}
                className="shrink-0 rounded border border-(--tmd-border) px-1.5 py-0.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
              >
                {t("套用")}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  pendingIndexRef.current = e.index;
                  act(t("已弹出 stash #{n}", { n: String(e.index) }), () =>
                    ipc.gitStashApply(cwd, e.index, false),
                  );
                }}
                className="shrink-0 rounded border border-(--tmd-border) px-1.5 py-0.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
              >
                {t("弹出")}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  const index = e.index;
                  setDropConfirm({
                    title: t("丢弃 stash #{n}?", { n: String(index) }),
                    detail: t("丢弃后不可恢复;如需保留改动请改用「套用」。"),
                    confirmLabel: t("丢弃"),
                    onConfirm: () => {
                      pendingIndexRef.current = index;
                      act(t("已丢弃 stash #{n}", { n: String(index) }), () =>
                        ipc.gitStashDrop(cwd, index),
                      );
                    },
                  });
                }}
                className="shrink-0 rounded border border-(--tmd-diff-removed)/40 px-1.5 py-0.5 text-(--tmd-diff-removed) hover:bg-(--tmd-diff-removed)/10 disabled:opacity-50"
              >
                {t("丢弃")}
              </button>
            </div>
          ))}
        </div>
      )}
      {dropConfirm && (
        <GitConfirmDialog
          state={dropConfirm}
          onClose={() => setDropConfirm(null)}
        />
      )}
    </div>
  );
}
