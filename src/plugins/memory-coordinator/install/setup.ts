/**
 * 安装编排 —— 非交互安装组合 + 迁移窗口状态机(PoC 定性核心流程)。
 *
 * 管线(spec §5.1,mac/linux 已实证、win 留 PoC-6):
 *   检测 → 安装+配置(非交互组合)→ 迁移触发(node bootstrap)→ 验证就绪。
 *
 * 关键 PoC 事实:
 * - 上游交互向导中途落盘不回滚 → 编排全程非交互、失败显式回滚;
 * - 迁移锁与 omp 常驻 worker 死锁:任一 omp 会话活着迁移即被拒
 *   (openDatabase 返回 null)→ 编排进入「迁移窗口」状态机:
 *   暂停 tmd-cli 自家 omp 会话(宿主全权)→ 检测外部进程引导 → 重试。
 */

import { ipc, type ProcRunResult } from "@kernel/ipc";
import { host } from "@kernel/host";
import { BOOTSTRAP_MJS } from "./bootstrap";
import { detectNode, detectOmpPluginInstalled, detectSharedDbReady } from "./detect";

export interface InstallStepResult {
  ok: boolean;
  message: string;
}

export type InstallPhase =
  | "idle"
  | "detecting"
  | "installing"
  | "configuring"
  | "migrating"
  | "blocked"
  | "ready"
  | "failed";

export interface InstallProgress {
  phase: InstallPhase;
  /** 终端式进度行(UI 逐条渲染)。 */
  lines: string[];
  /** 迁移被外部进程阻塞时的 PID 列表(blocked 态非空)。 */
  blockedPids: number[];
}

async function run(cmd: string, args: string[], timeoutMs: number): Promise<ProcRunResult> {
  return ipc.procCommunicate({ command: cmd, args, cwd: ".", timeoutMs });
}

export class InstallOrchestrator {
  private pausedSessionIds: string[] = [];

  /** 迁移窗口第一步:暂停 tmd-cli 自家的全部 omp 会话(宿主全权,外部会话不动)。 */
  pauseOwnOmpSessions(): number {
    const sessions = host.getSessions().filter((s) => s.profileId === "omp");
    for (const s of sessions) {
      void ipc.sessionKill(s.id).catch(() => undefined);
      this.pausedSessionIds.push(s.id);
    }
    return this.pausedSessionIds.length;
  }

  /** 恢复暂停的会话记录(仅清编排账本,重启由用户/面板操作)。 */
  clearPauseLedger(): void {
    this.pausedSessionIds = [];
  }

  /** 非交互安装:omp plugin install + 写配置 + 改 omp config 的组合前置已由调用方确认。 */
  async installIntoOmp(onLine: (line: string) => void): Promise<InstallStepResult> {
    const r = await run("omp", ["plugin", "install", "@cortexkit/pi-magic-context"], 120_000);
    if (r.code !== 0) {
      return { ok: false, message: `插件安装失败(exit ${r.code}): ${r.stderr.slice(0, 200)}` };
    }
    onLine("✓ omp 插件注册成功(原生 compaction / memory 由其接管)");
    return { ok: true, message: "" };
  }

  /** pi 侧安装:pi install npm:(上游 README 实证路径)。 */
  async installIntoPi(onLine: (line: string) => void): Promise<InstallStepResult> {
    const r = await run("pi", ["install", "npm:@cortexkit/pi-magic-context"], 120_000);
    if (r.code !== 0) {
      return { ok: false, message: `pi 安装失败(exit ${r.code}): ${r.stderr.slice(0, 200)}` };
    }
    onLine("✓ pi 插件注册成功");
    return { ok: true, message: "" };
  }

  /** opencode 侧安装:改其配置(plugin 数组 + 禁原生 compaction,README 实证形态)。 */
  async installIntoOpencode(
    configPath: string,
    readText: (p: string) => Promise<string>,
    writeText: (p: string, t: string) => Promise<void>,
    onLine: (line: string) => void,
  ): Promise<InstallStepResult> {
    let backup: string | null = null;
    try {
      // 备份原文(含注释):解析/写入失败时回滚,不丢用户配置
      backup = await readText(configPath).catch(() => null);
      const raw = backup ?? "{}";
      const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
      const cfg = JSON.parse(stripped) as Record<string, unknown>;
      const plugins = Array.isArray(cfg.plugin) ? (cfg.plugin as unknown[]) : [];
      if (!plugins.some((x) => typeof x === "string" && x.includes("opencode-magic-context"))) {
        plugins.push("@cortexkit/opencode-magic-context@latest");
      }
      cfg.plugin = plugins;
      cfg.compaction = { ...(typeof cfg.compaction === "object" && cfg.compaction ? cfg.compaction : {}), auto: false, prune: false };
      await writeText(configPath, JSON.stringify(cfg, null, 2) + "\n");
      onLine("✓ opencode 配置更新(plugin 注册 + 原生 compaction 交由 Magic Context)");
      return { ok: true, message: "" };
    } catch (e) {
      if (backup !== null) await writeText(configPath, backup).catch(() => {});
      return { ok: false, message: `opencode 配置更新失败(已回滚原文): ${String(e).slice(0, 140)}` };
    }
  }

  /** node bootstrap 迁移:经 -e 执行内置脚本打开共享库(锁检测+版本围栏+迁移)。 */
  async runBootstrap(distDir: string, onLine: (line: string) => void): Promise<InstallStepResult> {
    const r = await run("node", ["-e", BOOTSTRAP_MJS, distDir], 60_000);
    const out = r.stdout.trim();
    if (out.startsWith("BOOTSTRAP-OK")) {
      onLine("✓ " + out);
      return { ok: true, message: out };
    }
    if (out.startsWith("REFUSED migration-locked")) {
      onLine("✗ 迁移被锁:仍有 omp/pi 进程持有共享库");
      return { ok: false, message: "migration-locked" };
    }
    onLine("✗ " + (out || "bootstrap 无输出"));
    return { ok: false, message: out };
  }

  /** 面板诊断:检测 + 迁移窗口状态汇总。 */
  async diagnose(): Promise<string[]> {
    const lines: string[] = [];
    const node = await detectNode();
    lines.push(`${node.available ? "✓" : "✗"} node / npx 可用${node.available ? ` (v${node.version})` : ""}`);
    if (!node.meetsUpstreamRequirement && node.available) {
      lines.push(`● 上游声明需 node ≥24,当前 v${node.version}(实测可跑,风险自担)`);
    }
    const plugin = await detectOmpPluginInstalled();
    lines.push(`${plugin ? "✓" : "✗"} omp 插件${plugin ? "已注册" : "未注册"}`);
    const dbReady = plugin ? await detectSharedDbReady(defaultDbPathForDiagnose()) : false;
    lines.push(`${dbReady ? "✓" : "✗"} 共享数据库${dbReady ? "完整性正常" : "未初始化或不可读"}`);
    return lines;
  }
}

/** 诊断用默认库路径(与 pool.ts 推断一致;bootstrap 回存后以 settings 为准)。 */
function defaultDbPathForDiagnose(): string {
  return ".local/share/cortexkit/magic-context/context.db";
}
