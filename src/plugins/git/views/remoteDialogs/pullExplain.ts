/**
 * pullExplain —— 拉取对话框 Intent / Will Happen / Will NOT Happen 解释文案。
 * 逐字复刻 codemoss utils/gitPullExplanation.ts 的 zh 文案:
 * 按 (strategy, noCommit, noVerify) 选 Intent 与 Will NOT Happen;
 * Will Happen 行 = strategy 行(或「按 Git 配置执行」)+ 可选 noCommit/noVerify 行。
 */
import { t } from "@kernel/i18n";

export type PullStrategy = "--rebase" | "--ff-only" | "--no-ff" | "--squash";


type EffectTone = "neutral" | "attention" | "muted";

interface PullEffectRow {
  /** 选项 code(如 --no-commit);strategy=default 行显示加粗「按 Git 配置执行」 */
  code: string | null;
  /** default 行的加粗标签 */
  label: string | null;
  tone: EffectTone;
  text: string;
}

type ExplainParams = {
  remote: string;
  targetBranch: string;
};

const INTENT: Record<Push1, (p: ExplainParams) => string> = {
  default: (p) => t("先从 {remote} 拉取 {targetBranch},再按当前仓库或用户的 Git 配置更新本地分支。", p),
  "--rebase": (p) => t("先从 {remote} 拉取 {targetBranch},再把你本地新增的提交接到远端最新提交后面。", p),
  "--ff-only": (p) => t("先从 {remote} 拉取 {targetBranch};只有本地可以直接跟上远端时才更新。", p),
  "--no-ff": (p) => t("先从 {remote} 拉取 {targetBranch};如果 Git 最终采用 merge,就保留一个明确的合并提交。已有 rebase 配置仍可能优先生效。", p),
  "--squash": (p) => t("先从 {remote} 拉取 {targetBranch};如果 Git 最终采用 merge,就把远端变化汇总为一组待提交改动。已有 rebase 配置仍可能优先生效。", p),
};
type Push1 = "default" | PullStrategy;

const EFFECT: Record<Push1, string> = {
  default: "你没有指定合并方式。Git 会读取当前分支、仓库或用户配置,因此不同仓库的结果可能不同。",
  "--rebase": "你本地新增的提交会重新接到远端最新提交后面,记录更整齐;遇到冲突会暂停,等你处理。",
  "--ff-only": "本地没有独立新提交时才会拉取成功;如果本地和远端已经分叉,操作会停止,不会自动改写提交记录。",
  "--no-ff": "仅在 merge 模式下:即使可以直接更新,也会创建一个合并提交。这个选项本身不会强制 Git 放弃已有 rebase 配置。",
  "--squash": "仅在 merge 模式下:远端变化会汇总为一组待提交改动,需要你之后手动提交。这个选项本身不会强制 Git 采用 merge。",
};

const EFFECT_NO_COMMIT: Record<Push1, { tone: EffectTone; text: string }> = {
  default: {
    tone: "neutral",
    text: "只有 Git 最终需要创建合并提交时才会在提交前停下;如果只是直接更新分支,这个选项没有额外作用。",
  },
  "--rebase": {
    tone: "muted",
    text: "这个参数仍会出现在命令中,但 rebase 不创建合并提交,因此不会增加「提交前暂停」的效果。",
  },
  "--ff-only": {
    tone: "muted",
    text: "直接更新分支不会创建合并提交,因此没有可暂停的提交,这个选项没有额外作用。",
  },
  "--no-ff": {
    tone: "neutral",
    text: "如果 Git 最终采用 merge,会在创建合并提交前停下,供你检查并手动提交;如果已有配置选择 rebase,就没有合并提交可暂停。",
  },
  "--squash": {
    tone: "muted",
    text: "在 merge 模式下,--squash 本来就会留下待提交改动,所以这个参数不会再改变结果;走 rebase 时也不会增加合并前暂停。",
  },
};

const EFFECT_NO_VERIFY: Record<Push1, { tone: EffectTone; text: string }> = {
  default: {
    tone: "attention",
    text: "如果 Git 最终创建合并提交,会跳过提交前自动检查(pre-merge-commit、commit-msg hooks);拉取和之后的手动提交不受影响。",
  },
  "--rebase": {
    tone: "muted",
    text: "这个参数仍会出现在命令中,但 rebase 不走合并提交检查,因此本次没有额外作用。",
  },
  "--ff-only": {
    tone: "muted",
    text: "直接更新分支不会创建合并提交,也不会运行对应的提交前检查,因此这个选项没有额外作用。",
  },
  "--no-ff": {
    tone: "attention",
    text: "如果 Git 最终创建合并提交,会跳过提交前自动检查,仓库规则可能因此被绕过;走 rebase 时不涉及这些合并检查。",
  },
  "--squash": {
    tone: "muted",
    text: "在 merge + squash 模式下不会自动创建合并提交,因此没有对应检查可跳过;走 rebase 时这个参数也没有额外的合并检查效果。",
  },
};

const WILL_NOT: Record<Push1, string> = {
  default: "不会把本地提交推送到远端。你没有指定合并方式时,界面不会承诺 Git 最终会 merge、rebase 还是停止。",
  "--rebase": "不会创建合并提交,也不会推送到远端;重新接到远端之后,本地提交的 commit hash 可能变化。",
  "--ff-only": "不会创建合并提交、不会 rebase、也不会推送到远端;分支已经分叉时不会自动整合。",
  "--no-ff": "不会推送到远端。这个选项本身不保证关闭 rebase;当前 Git 配置仍可能让 rebase 生效。",
  "--squash": "不会推送到远端。如果当前 Git 配置选择 rebase,界面不能保证最终会留下「一组待提交改动」。",
};

export function resolvePullExplanation(
  strategy: PullStrategy | null,
  noCommit: boolean,
  noVerify: boolean,
  params: ExplainParams,
): { intent: string; rows: PullEffectRow[]; willNot: string } {
  const key: Push1 = strategy ?? "default";
  const rows: PullEffectRow[] = [
    strategy == null
      ? { code: null, label: "按 Git 配置执行", tone: "neutral", text: EFFECT[key] }
      : { code: strategy, label: null, tone: "neutral", text: EFFECT[key] },
  ];
  if (noCommit) {
    rows.push({ code: "--no-commit", label: null, ...EFFECT_NO_COMMIT[key] });
  }
  if (noVerify) {
    rows.push({ code: "--no-verify", label: null, ...EFFECT_NO_VERIFY[key] });
  }
  return { intent: INTENT[key](params), rows, willNot: WILL_NOT[key] };
}
