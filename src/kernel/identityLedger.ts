/**
 * CLI 磁盘身份账本 —— 自 hostWatches 拆出(文件规模铁则)。
 * 活会话 → CLI 磁盘身份绑定(omp/pi 的 jsonl uuid、codex 的 rollout id)。
 *
 * 跨 webview 重载持久化:PTY 经 readopt 跨重载存活,身份若不跟随,活行丢
 * cliSessionId —— 手动命名/磁盘原生标题(首条用户消息兜底)全失联,重命名
 * 退化为短码,活/盘去重失效,状态 pill 失明(2026-09-17 实证:HMR 重载后
 * 两个活会话 tab 退回短码标题)。存储循 filePanel/promptHistory 惯例
 * (localStorage 单 key,纯映射不进 settings schema)。死项只认活会话表:
 * readopt 定稿后 prune(冷启动 Rust 注册表为空 = 一次清空陈账;重载 =
 * 活表全保留),会话退出即删照旧 —— 陈账占用的磁盘身份会 fail-closed 挡住
 * 后续 resume 同身份的新会话,剪除不可省。
 */

import { noteLogBinding } from "./diskReplay";
import { sessionArchiveKey, unarchiveSession } from "./sessionArchive";
import type { SessionMeta } from "./ipc";

const STORAGE_KEY = "tmd.identityLedger.v1";

function loadStored(): Map<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed.filter(
        (pair): pair is [string, string] =>
          Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string",
      ),
    );
  } catch {
    return new Map(); /* 无 localStorage(测试环境)或损坏数据:按空账本起 */
  }
}

function saveStored(map: ReadonlyMap<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...map]));
  } catch {
    /* 尽力而为:持久化失败只伤下次重载的标题/去重/状态,不影响本次绑定 */
  }
}

export class IdentityLedger {
  private readonly map = loadStored();

  constructor(
    private readonly findSession: (sessionId: string) => SessionMeta | undefined,
  ) {}

  /** 活会话绑定的 CLI 磁盘身份;未绑定(探测前)为 undefined。 */
  get(sessionId: string): string | undefined {
    return this.map.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.map.has(sessionId);
  }

  /** 已被持有的全部磁盘身份(身份守望 claimed 过滤用快照)。 */
  claimedIds(): Set<string> {
    return new Set(this.map.values());
  }

  remove(sessionId: string): void {
    if (!this.map.delete(sessionId)) return;
    saveStored(this.map);
  }

  /** 对活会话表剪除死项(readopt 定稿后调用;时机语义见文件头)。 */
  prune(): void {
    let changed = false;
    for (const id of [...this.map.keys()]) {
      if (!this.findSession(id)) {
        this.map.delete(id);
        changed = true;
      }
    }
    if (changed) saveStored(this.map);
  }

  /**
   * 绑定表唯一写入口:一个 CLI 磁盘身份只准一个活会话持有。身份守望的
   * claimed 过滤是快照式(await 期间会过期),此处是绑定落表的同步终审
   * (实证:四会话共绑一老会话,ptys 各自 resume 了同一磁盘会话)。抢绑失败
   * = 新会话保持未绑定(fail-closed):账本按 tmd id 隔离,UI 不去重不并账。
   */
  bind(sessionId: string, cliSessionId: string): boolean {
    const rival = [...this.map.entries()].some(
      ([id, cid]) => id !== sessionId && cid === cliSessionId,
    );
    if (rival) return false;
    this.map.set(sessionId, cliSessionId);
    saveStored(this.map);
    const meta = this.findSession(sessionId);
    if (meta) {
      noteLogBinding(meta.profileId, meta.cwd, cliSessionId, sessionId);
      /* 绑定即续命(生命周期 2026-09-17 修订):归档会话经任何绑定路径恢复对话
         (显式 resume / 远程恢复 / CLI 内 /resume 探测)即解除归档,生命周期链重启
         (待运行 ⇄ 运行中);干净退出由 boardExit 再归档收口。key 构造与
         archiveExitedSession 同构;无归属工作区不猜归属(同款守卫)。 */
      if (meta.workspaceId)
        unarchiveSession(
          sessionArchiveKey(meta.workspaceId, meta.engine ?? meta.profileId, cliSessionId),
        );
    }
    return true;
  }
}
