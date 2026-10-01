/**
 * 手机续聊引擎表 —— 以 Rust 端白名单为准(src-tauri/src/web/conn.rs
 * spawn_command_allowed 的 ENGINES,2026-09-28 全 10 家对齐):
 * 新增引擎须双处同步(本表 + conn.rs 白名单),漏一侧 = 手机发起被域闸打回。
 * cmd/resume 镜像各桌面插件 profile(omp/pi/claude/grok/qoder 用 --resume,
 * codex 用子命令 resume,kimi/opencode 用 --session,dsh 用 --resume;
 * 源:各 cli- 插件 index.tsx + cli-shared/qoderPlugin.tsx + cli-dsh/plugin.tsx)。
 * 注意:dsh 桌面侧有 spawnTransform(改写 node 跑适配器),桥 spawn 不经桌面前端
 * 装配 → 手机发起的是裸 dsh 命令;resume 的 --resume 翻译也只在桌面路径生效。
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
  { id: "qoder", name: "Qoder", cmd: "qodercli", resume: (s) => ["--resume", s] },
  { id: "qoder-cn", name: "Qoder CN", cmd: "qoderclicn", resume: (s) => ["--resume", s] },
  { id: "opencode", name: "OpenCode", cmd: "opencode", resume: (s) => ["--session", s] },
  { id: "dsh", name: "DSH", cmd: "dsh", resume: (s) => ["--resume", s] },
];

export const engineOf = (profileId: string): MobileEngine | undefined =>
  ENGINES.find((e) => e.id === profileId);
