/**
 * 存储体检类目 —— 分桶路径定义(纯函数,可测)。
 *
 * 路径常量对齐各 cli-* 插件的会话目录实证(feasibility §6):
 * omp/pi = ~/.omp|~/.pi/agent/sessions,claude/qoder = ~/.claude|~/.qoder/projects,
 * codex = ~/.codex/sessions,kimi 新旧两代 = ~/.kimi-code|~/.kimi/sessions,
 * grok = ~/.grok/sessions,qoder-cn = ~/.qoder-cn/projects,dsh = ~/.dsh/sessions。
 * checkpoints/docgen/自家 session 日志在 ~/.tmd-cli 内(configDir 注入,桩环境可测)。
 */

export interface AuditCategory {
  /** 稳定类目键(报表 label 与报告映射键)。 */
  key: string;
  path: string;
  /** 递归跳过的目录名;全部为空 —— checkpoints 的 objects.git 必须计入,
   *  CLI 会话目录无 git 内嵌,命令不硬编码 .git。 */
  skipDirNames: string[];
}

/** 类目清单:home = 用户主目录,configDir = ~/.tmd-cli。顺序即报表行序。 */
export function auditCategories(home: string, configDir: string): AuditCategory[] {
  return [
    { key: "checkpoints", path: `${configDir}/checkpoints`, skipDirNames: [] },
    { key: "session-logs", path: `${configDir}/session`, skipDirNames: [] },
    { key: "docgen", path: `${configDir}/workbench/docgen`, skipDirNames: [] },
    { key: "omp", path: `${home}/.omp/agent/sessions`, skipDirNames: [] },
    { key: "pi", path: `${home}/.pi/agent/sessions`, skipDirNames: [] },
    { key: "claude", path: `${home}/.claude/projects`, skipDirNames: [] },
    { key: "qoder", path: `${home}/.qoder/projects`, skipDirNames: [] },
    { key: "codex", path: `${home}/.codex/sessions`, skipDirNames: [] },
    { key: "kimi", path: `${home}/.kimi-code/sessions`, skipDirNames: [] },
    { key: "kimi-legacy", path: `${home}/.kimi/sessions`, skipDirNames: [] },
    { key: "qoder-cn", path: `${home}/.qoder-cn/projects`, skipDirNames: [] },
    { key: "grok", path: `${home}/.grok/sessions`, skipDirNames: [] },
    { key: "dsh", path: `${home}/.dsh/sessions`, skipDirNames: [] },
  ];
}

/** 按类目键组报告:fsDirUsage 回按 label 对齐,缺失项(不应发生)不渲染。 */
export function reportByKey(
  reports: { label: string; bytes: number; files: number; timedOut: boolean }[],
): Record<string, { bytes: number; files: number; timedOut: boolean }> {
  const out: Record<string, { bytes: number; files: number; timedOut: boolean }> = {};
  for (const r of reports) out[r.label] = { bytes: r.bytes, files: r.files, timedOut: r.timedOut };
  return out;
}
