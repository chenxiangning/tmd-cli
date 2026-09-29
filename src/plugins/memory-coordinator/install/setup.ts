/**
 * 安装编排 —— 非交互安装组合 + 迁移窗口状态机(PoC 定性核心流程)。
 *
 * 管线(spec §5.1;2026-09-06 三平台实证,win 新装机随契约落地
 * docs/architecture/04-windows-platform-contract.md):
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
import { updateSettings, getSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { BOOTSTRAP_MJS } from "./bootstrap";
import { detectNode, detectOmpPluginInstalled, detectSharedDbReady } from "./detect";
import { memoryDbPath, ensureParentDir } from "../paths";

interface InstallStepResult {
  ok: boolean;
  message: string;
}

async function run(cmd: string, args: string[], timeoutMs: number): Promise<ProcRunResult> {
  return ipc.procCommunicate({ command: cmd, args, cwd: ".", timeoutMs });
}

export class InstallOrchestrator {
  private pausedSessionIds: string[] = [];
  /** 迁移窗口第一步:暂停 tmd-cli 自家的全部 omp 会话(宿主全权,外部会话不动)。
   *  必须 await 进程真正退出:kill 到 SQLite 锁释放有毫秒~秒级延迟,不等待则
   *  紧随的 bootstrap 重试仍命中锁,误导为「外部进程占用」(2026-09-06 评审)。 */
  async pauseOwnOmpSessions(): Promise<number> {
    const sessions = host.getSessions().filter((s) => s.profileId === "omp");
    await Promise.allSettled(sessions.map((s) => ipc.sessionKill(s.id)));
    this.pausedSessionIds.push(...sessions.map((s) => s.id));
    return sessions.length;
  }

  /** 恢复暂停的会话记录(仅清编排账本,重启由用户/面板操作)。 */
  clearPauseLedger(): void {
    this.pausedSessionIds = [];
  }

  /** 非交互安装:omp plugin install + 写配置 + 改 omp config 的组合前置已由调用方确认。 */
  async installIntoOmp(onLine: (line: string) => void): Promise<InstallStepResult> {
    const r = await run("omp", ["plugin", "install", "@cortexkit/pi-magic-context"], 120_000);
    if (r.code !== 0) {
      return { ok: false, message: t("插件安装失败(exit {code}): {err}", { code: r.code, err: r.stderr.slice(0, 200) }) };
    }
    onLine(t("✓ omp 插件注册成功(原生 compaction / memory 由其接管)"));
    return { ok: true, message: "" };
  }

  /** pi 侧安装:pi install npm:(上游 README 实证路径)。 */
  async installIntoPi(onLine: (line: string) => void): Promise<InstallStepResult> {
    const r = await run("pi", ["install", "npm:@cortexkit/pi-magic-context"], 120_000);
    if (r.code !== 0) {
      return { ok: false, message: t("pi 安装失败(exit {code}): {err}", { code: r.code, err: r.stderr.slice(0, 200) }) };
    }
    onLine(t("✓ pi 插件注册成功"));
    return { ok: true, message: "" };
  }

  /** opencode 侧安装:改其配置(plugin 数组 + 禁原生 compaction,README 实证形态)。 */
  async installIntoOpencode(
    configPath: string,
    readText: (p: string) => Promise<string>,
    writeText: (p: string, text: string) => Promise<void>,
    onLine: (line: string) => void,
  ): Promise<InstallStepResult> {
    let backup: string | null = null;
    try {
      // 备份原文(含注释):解析/写入失败时回滚,不丢用户配置
      backup = await readText(configPath).catch(() => null);
      // 落点可能全新(全候选缺失时按官方布局新建 opencode.json):父目录
      // ~/.config/opencode 在 Windows 新机不存在,直接写 = ENOENT(2026-09-28 评审)
      await ensureParentDir(configPath);
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
      onLine(t("✓ opencode 配置更新(plugin 注册 + 原生 compaction 交由 Magic Context)"));
      return { ok: true, message: "" };
    } catch (e) {
      if (backup !== null) await writeText(configPath, backup).catch(() => {});
      /* backup=null = 新建文件未写成,无「原文」可回滚,文案如实(2026-09-28 评审) */
      return {
        ok: false,
        message: t(
          backup !== null
            ? "opencode 配置更新失败(已回滚原文): {err}"
            : "opencode 配置更新失败(新文件未写入): {err}",
          { err: String(e).slice(0, 140) },
        ),
      };
    }
  }

  /** node bootstrap 迁移:经 -e 执行内置脚本打开共享库(锁检测+版本围栏+迁移)。 */
  async runBootstrap(distDir: string, onLine: (line: string) => void): Promise<InstallStepResult> {
    const r = await run("node", ["-e", BOOTSTRAP_MJS, distDir], 60_000);
    const out = r.stdout.trim();
    if (out.startsWith("BOOTSTRAP-OK")) {
      onLine("✓ " + out);
      /* 回存实际落点(BOOTSTRAP-OK <storageDir> schema=.. memories=..):
        上游解析受 XDG_DATA_HOME / MAGIC_CONTEXT_STORAGE_DIR 影响,此前读侧
        硬编码默认路径 —— 迁移写 A 处、面板/池读 B 处,状态恒「未安装」
        (2026-09-28 评审;storageDir="?"=上游未提供,保持默认推断)。
        storageDir 可能含空格(Windows 用户名),只能从尾部 schema= 前截取 */
      const dir = out
        .slice("BOOTSTRAP-OK ".length, out.lastIndexOf(" schema="))
        .trim();
      if (dir && dir !== "?") updateSettings({ memoryDbPath: `${dir}/context.db` });
      return { ok: true, message: out };
    }
    if (out.startsWith("REFUSED migration-locked")) {
      onLine(t("✗ 迁移被锁:仍有 omp/pi 进程持有共享库"));
      return { ok: false, message: "migration-locked" };
    }
    onLine("✗ " + (out || t("bootstrap 无输出")));
    return { ok: false, message: out };
  }

  /** 面板诊断:检测 + 迁移窗口状态汇总。 */
  async diagnose(): Promise<string[]> {
    const lines: string[] = [];
    const node = await detectNode();
    lines.push(`${node.available ? "✓" : "✗"} ${t("node / npx 可用")}${node.available ? ` (v${node.version})` : ""}`);
    if (!node.meetsUpstreamRequirement && node.available) {
      lines.push(t("● 上游声明需 node ≥24,当前 v{v}(实测可跑,风险自担)", { v: node.version }));
    }
    const plugin = await detectOmpPluginInstalled();
    /* 与 pool 同源:优先 bootstrap 回存落点,否则默认推断(2026-09-28 评审) */
    const dbPath = getSettingsState().settings.memoryDbPath || (await memoryDbPath());
    const dbReady = plugin ? await detectSharedDbReady(dbPath) : false;
    lines.push(dbReady ? t("✓ 共享数据库完整性正常") : t("✗ 共享数据库未初始化或不可读"));
    return lines;
  }
}

