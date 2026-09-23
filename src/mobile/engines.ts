/**
 * 手机续聊引擎表 —— resume 参数镜像各桌面插件 profile.resumeArgs
 * (omp/pi/claude/grok/qoder/dsh 用 --resume,codex 用子命令 resume,
 * kimi/opencode 用 --session;源:各 cli- 插件 index.tsx + cli-shared/qoderPlugin.tsx)。
 * cmd = 启动命令 basename,与 SpawnSheet 引擎表同集合;手机 UI 只能从表内取引擎,
 * 自由 command 在桌面域闸打回(spawn_command_allowed)。
 */
export interface MobileEngine {
  id: string;
  name: string;
  cmd: string;
  resume: (cliSessionId: string) => string[];
}

export const ENGINES: MobileEngine[] = [
  { id: "omp", name: "OMP", cmd: "omp", resume: (s) => ["--resume", s] },
  { id: "pi", name: "Pi", cmd: "pi", resume: (s) => ["--resume", s] },
  { id: "claude", name: "Claude Code", cmd: "claude", resume: (s) => ["--resume", s] },
  { id: "codex", name: "Codex CLI", cmd: "codex", resume: (s) => ["resume", s] },
  { id: "kimi", name: "Kimi", cmd: "kimi", resume: (s) => ["--session", s] },
  { id: "grok", name: "Grok", cmd: "grok", resume: (s) => ["--resume", s] },
  { id: "qoder", name: "Qoder", cmd: "qoder", resume: (s) => ["--resume", s] },
  { id: "opencode", name: "OpenCode", cmd: "opencode", resume: (s) => ["--session", s] },
];

export const engineOf = (profileId: string): MobileEngine | undefined =>
  ENGINES.find((e) => e.id === profileId);
