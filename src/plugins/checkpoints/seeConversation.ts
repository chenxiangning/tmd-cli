/**
 * 「看对话」动作 —— 批次 ↔ 对话时间线反向互跳的批侧接线(候选8,feasibility §8)。
 * 定位/恢复时序桥在 kernel(openThenJumpToText:活会话按 cli 身份直跳;已关会话
 * openDiskSession 后等幕布挂载再跳);本文件只补账本不存的 profileId:活会话
 * 持有者直取;已关会话扫各引擎磁盘列表唯一认领 —— 多引擎同 id 歧义与零命中
 * 都不猜,返回 null(不打开,调用方按 miss 提示)。cwd 顺带解析 workspaceId
 * (openDiskSession 工作区解析口径,不带工作区 id 的会话不进侧栏树)。
 */
import { openThenJumpToText, type JumpTextOutcome } from "@kernel/anchorJump";
import { openSessionViewAtText } from "@kernel/sessionViewTabs";
import { host } from "@kernel/host";
import { getWorkspaces } from "@kernel/workspace";

/** cwd → 工作区 id(useCkptScope 归属判定同款口径);无归属返回 undefined。 */
function workspaceIdOf(cwd: string): string | undefined {
  return getWorkspaces().find((w) => cwd === w.root || cwd.startsWith(`${w.root}/`))?.id;
}

/**
 * 账本身份 → 引擎 profileId(唯一认领),解析不到返回 null。
 * 活会话先查:tmd id 直认或绑定 cli 身份认亲(resume 换壳后 tmd id 已变);
 * 已关会话再扫磁盘:各 profile 的 listSessions 唯一命中才认领。
 */
export async function resolveLedgerProfileId(
  cwd: string,
  ledgerSessionId: string,
): Promise<string | null> {
  const live = host
    .getSessions()
    .find((s) => s.id === ledgerSessionId || host.getCliSessionId(s.id) === ledgerSessionId);
  if (live) return live.profileId;
  const engines = host.getCliProfiles().filter((p) => p.listSessions);
  const claims = await Promise.all(
    engines.map(async (p) => {
      try {
        return (await p.listSessions!(cwd)).some((r) => r.id === ledgerSessionId) ? p.id : null;
      } catch {
        return null; /* 单引擎扫描失败忽略(列表不全时宁可不跳) */
      }
    }),
  );
  const hits = claims.filter((x): x is string => x !== null);
  return hits.length === 1 ? hits[0] : null; /* 零命中或多引擎同 id,歧义不猜 */
}

/** 批次 → 对话:解析 profileId 后交内核时序桥;profileId 解析不到 = miss。
 *  occurrence = 本批 prompt 在同文批次中的出现序(1-based,反向跳同文
 *  多轮时定位本批那条,缺省 1)。 */
export async function viewBatchConversation(opts: {
  cwd: string;
  ledgerSessionId: string;
  prompt: string;
  occurrence?: number;
}): Promise<JumpTextOutcome> {
  const profileId = await resolveLedgerProfileId(opts.cwd, opts.ledgerSessionId);
  if (!profileId) return "miss";
  const outcome = await openThenJumpToText(
    {
      profileId,
      cwd: opts.cwd,
      workspaceId: workspaceIdOf(opts.cwd),
      cliSessionId: opts.ledgerSessionId,
    },
    opts.prompt,
    { occurrence: opts.occurrence },
  );
  /* 幕布不可达(超回放窗/needle 未命中)→ 转录查看器兜底:磁盘全量文本定位
     (0.4.2 批一追加;profileId 已唯一认领才兜,歧义不猜)。兜底已开查看器,
     返回值改判 opened —— 调用方文案不得再报「未定位到」。 */
  if (outcome !== "jumped") {
    openSessionViewAtText(
      { profileId, cwd: opts.cwd, cliSessionId: opts.ledgerSessionId },
      opts.prompt,
      opts.occurrence ?? 1,
    );
    return "opened";
  }
  return outcome;
}
