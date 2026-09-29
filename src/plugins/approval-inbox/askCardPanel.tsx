/**
 * omp ask 卡操作面板(从 panel.tsx 拆出,文件规模铁则)。
 * 键位语义取自 pi-tui overlays/ask-dialog.ts 源码(权威,非页脚推断):
 * - select 题(单选):Enter = 选当前光标项并自动跳下一题(多问)/即选即提交(单问);无数字直选。
 * - multi 题(多选):空格 = toggle 光标项;Enter = 确认当前选择跳下一题。
 * - ⇥ 全程可切 tab;Submit tab 上 Enter = 提交。
 * 面板代发:选项点击 = ↑/↓ 移到该项 + Enter(select)/空格(multi);题 pill = ⇥×k;
 * Submit pill = ⇥×k + 回车。光标基准用解析帧值(1-2 拍刷新回真),连点快于帧刷新
 * 或在幕布手动动过光标会漂移 —— title 已注明以幕布为准。
 */
import { useRef } from "react";
import { t } from "@kernel/i18n";
import { answerKeys } from "./store";
import { jumpTabKeys, moveKeys, type AskCard } from "./askCard";

export function CardBlock({ card, sessionId }: { card: AskCard; sessionId: string }) {
  const multi = card.kind === "multi";
  const questionCount = card.tabs.length > 0 ? card.tabs.length - 1 : 1;
  const send = (keys: string) => void answerKeys(sessionId, keys);
  /* 面板侧 tab 位跟踪:CLI tab 位随操作前进(select Enter 自动跳题),键序
     不能恒按 tab0 绝对计数,否则回绕到已答题误代发 Enter(三轮 R3-AB-02)。
     仅 handler 内改写、不参与渲染 = ref;跨 ask 重置由父级 key(sessionId +
     tab 集)重挂载归零。幕布手动切过仍会漂移,以幕布为准。 */
  const tabPosRef = useRef(0);

  const pickOption = (i: number) => {
    send(moveKeys(card.cursor, i) + (multi ? " " : "\n"));
    /* select Enter = 选当前项并自动跳下一题(pi-tui 语义);multi 空格只 toggle 不跳题。 */
    if (!multi && card.tabs.length > 0) tabPosRef.current = (tabPosRef.current + 1) % card.tabs.length;
  };
  const jumpTo = (target: number) => {
    send(jumpTabKeys(tabPosRef.current, target, card.tabs.length));
    tabPosRef.current = target;
  };
  const submit = () => {
    send(jumpTabKeys(tabPosRef.current, card.tabs.length - 1, card.tabs.length) + "\n");
    tabPosRef.current = card.tabs.length - 1;
  };

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
        <span title={card.question} className="min-w-0 truncate text-[0.6875rem] leading-[1.125rem] text-(--tmd-fg)">
          {card.question}
        </span>
        {questionCount > 1 && (
          <span className="flex-none rounded bg-(--tmd-bg-subtle) px-1 text-[0.5625rem] leading-[1rem] text-(--tmd-warn)">
            {t("{n} 个问题", { n: questionCount })}
          </span>
        )}
      </div>
      {card.tabs.length > 0 && (
        <div className="mt-1 flex items-center gap-1">
          {card.tabs.map((name, i) => {
            const isSubmit = i === card.tabs.length - 1;
            return (
              <button
                key={name}
                type="button"
                title={
                  isSubmit
                    ? t("提交全部答案(⇥ 到 Submit + 回车)")
                    : t("切到「{name}」(⇥ 跳题)", { name })
                }
                onClick={() => (isSubmit ? submit() : jumpTo(i))}
                className="rounded bg-(--tmd-bg-subtle) px-1 py-0.5 text-[0.5625rem] leading-[1rem] text-(--tmd-fg-muted) hover:text-(--tmd-accent)"
              >
                {isSubmit ? `⏎ ${name}` : name}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-1 flex flex-col items-stretch gap-0.5">
        {card.options.map((opt, i) => (
          <button
            key={opt}
            type="button"
            title={t("选择该项并推进(↑/↓ + {key});若在幕布手动动过光标,以幕布为准", {
              key: multi ? t("空格勾选") : "⏎",
            })}
            onClick={() => pickOption(i)}
            className="flex items-center gap-1.5 rounded border border-(--tmd-border) px-1.5 py-0.5 text-left text-[0.625rem] leading-[1.125rem] text-(--tmd-fg-muted) hover:border-(--tmd-accent) hover:text-(--tmd-accent)"
          >
            {multi && card.cursor === i && (
              <span aria-hidden className="font-mono text-[0.5625rem] text-(--tmd-accent)">
                ❯
              </span>
            )}
            <span className="min-w-0 truncate">{opt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
