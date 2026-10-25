/**
 * anim · tmd-anim 项目文件面(纯函数,无 ipc 依赖)。
 *
 * tmd-anim 的项目磁盘布局:~/.tmd-anim/projects/<id>.json,单文件即一项目,
 * 形状 = { version: 1, name, canvas?, scenes: Scene[] }(tmd-anim src/core/types.ts)。
 * 本插件只做最小解析(取 name 供展示),容错优先:解析失败显示「无效项目」,
 * 绝不崩;协议知识(~/.tmd-anim/protocol/*)归 tmd-anim 侧同步。
 * 本模块除底部轮询读缓存的模块级 Map 外保持纯函数,无 ipc 依赖(读经 DI 注入)。
 */

/** tmd-anim 项目目录(绝对路径需先经 ipc.configHomeDir() 取 home)。 */
export function animProjectsDir(home: string): string {
  return `${home}/.tmd-anim/projects`;
}

/** 项目文件判定:目录列表过滤用,只认小写 .json(tmd-anim 自家命名约定)。 */
export function isAnimProjectFile(name: string): boolean {
  return !name.startsWith(".") && name.endsWith(".json");
}

/** 「打开」动作按平台分派(042 随手带,0.3.9 口径修订):
 *  mac = tmd-anim 应用 open-with(`open -a`,需应用探测);windows = 文件管理器
 *  目录定位(explorer /select 原语,fsRevealInFileManager,不依赖桌面应用);
 *  其余平台 null = 隐藏「打开」钮(0.3.9 非 mac 隐藏语义保留)。 */
export type AnimOpenAction = "app" | "reveal" | null;
export function animOpenAction(platform: string): AnimOpenAction {
  if (platform === "macos") return "app";
  if (platform === "windows") return "reveal";
  return null;
}

/** 最小合法项目解析:只验 version/name/scenes 三个契约字段,其余忽略;
 *  scenes 数量顺手带出供列表行展示。 */
export function parseAnimProject(raw: string): { name: string; scenes: number } | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const { version, name, scenes } = doc as Record<string, unknown>;
  if (version !== 1) return null;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (!Array.isArray(scenes)) return null;
  return { name, scenes: scenes.length };
}

/** 最小合法项目桩(tmd-anim 打开即认;用户在应用里改名)。 */
export function stubProjectJson(): string {
  return JSON.stringify({ version: 1, name: "未命名动画", scenes: [] }, null, 2);
}

/** 桩文件名:p_anim_<base36 时间>_<短随机>;调用方供 now 与随机段(纯函数可测)。 */
export function stubProjectFileName(now: number, rand: string): string {
  return `p_anim_${now.toString(36)}_${rand}.json`;
}

/** 初始 prompt 正文(发给 CLI 的可编辑指令,中文工作台惯例不走 t(),先例 workbench/taskPrompt)。
 *  语义对齐 tmd-anim 0.1.9 buildAiPrompt:叙事配方库指路、三类活例按需选读、配音超长自动
 *  延长不截断、validate 带文件参数、TTS 按平台分支(Windows 走 PowerShell System.Speech)。
 *  具体路径不入正文:引用文件在确认窗里以卡片预览,启动后挂 composer 卡片,发送时经
 *  animRefsSendTransform 拼回 wire。 */
export function buildAnimSessionPrompt(windows = false): string {
  const tts = windows
    ? [
        "解说/台词用 PowerShell 合成 WAV:powershell -c \"Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('tmd-tts.wav'); $s.Speak('台词'); $s.Dispose()\"(在可写目录执行,WAV 浏览器可直接解码,无需转码)。",
      ]
    : [
        "解说/台词用 macOS 自带 TTS 合成:`say -o /tmp/tmd-tts.aiff \"台词\"`,",
        "再转码 `afconvert -f m4af -d aac /tmp/tmd-tts.aiff /tmp/tmd-tts.m4a`(aiff 浏览器不解码,必须转),",
      ];
  return [
    "你是 tmd-anim 动画修改助手。",
    "先阅读随附引用文件中的协议材料(schema、叙事配方与小黑风格包),严格遵守其中约定;构图与编排拿不准时,先套叙事配方库里的模板再填内容。",
    "按用户后续要求修改随附的目标项目文件;只改目标项目文件,保持 schema 合法。",
    "需要「小黑 / 手绘 / 怪诞 / 正文配图」风格时,先读小黑风格配方与活例再动手。",
    "协议目录下还有三个活例,都是大文件,按需选读、不必全文读:http-example.json(协议全家福)、showcase-example.json(新元素全家福,含时间轴三段)、infographic-example.json(学术信息图)。",
    "用户需要配音/背景音乐时,给对应场景加 audio 字段(协议 schema 已定义:",
    "src 为音频文件 dataURL,volume 0-2;音频有效时长超过场景时长时,场景自动延长到配音结束,不会中途截断)。",
    "音频一律本机生成,不要访问网络下载(本环境不保证外网可达):",
    ...tts,
    "台词写口语短句:一句一个信息点,句末用句号,标点即停顿;macOS 直调 say 时想加长句间停顿可用内嵌命令,如 \"第一句。[[slnc 400]]第二句\"(逗号处 [[slnc 180]])。",
    "提示音/简单旋律用 python3 脚本直接合成 WAV;最后把文件 base64 拼成 dataURL 写入 audio.src。",
    "每轮修改完成后:建议用户在 tmd-anim 应用里查看效果;",
    "如需自查,可在 tmd-anim 仓库目录内运行 `pnpm anim validate <目标项目文件路径>`",
    "(该命令只在 tmd-anim 仓库内可用,其他目录运行无意义;退出码 2 = 结构错误必须修,警告逐条看)。",
  ].join("\n");
}

/** 确认窗预览卡与 composer 引用 chip 的唯一清单(协议材料 + 目标项目,
 *  label = i18n 源键,kind = 预览卡图标)。清单对齐 tmd-anim protocolSync
 *  投递面(0.1.9:新增 recipes.md;0.1.5+ 已不投递 bpe-example.json);
 *  三个活例 JSON 体积大,不挂卡只进 prompt 正文按需提及。 */
export function animSessionRefs(
  home: string,
  projectPath: string,
): { label: string; path: string; kind: "doc" | "code" }[] {
  const protocol = `${home}/.tmd-anim/protocol`;
  return [
    { label: "协议 schema", path: `${protocol}/schema.md`, kind: "doc" },
    { label: "叙事配方", path: `${protocol}/recipes.md`, kind: "doc" },
    { label: "小黑风格配方", path: `${protocol}/xiaohei-style.md`, kind: "doc" },
    { label: "小黑风格示例", path: `${protocol}/xiaohei-example.json`, kind: "code" },
    { label: "目标项目", path: projectPath, kind: "code" },
  ];
}

/* ── 读失败归因(fs_read_bytes_base64 的报错形态,不猜)──────────────────
 * Rust 侧四种 Err:metadata 失败(被删/权限,io Display 恒带 os error N)、
 * 「目标路径不是文件」、「文件超过 32MB 读取上限」(自家闸,形态确定)、
 * 读字节失败。按形态三归:deleted / oversize / io(显性透出原文)。 */

/** 归类读失败:超限 = 「项目过大」;ENOENT(os error 2)= 「项目已删除」;
 *  Windows 路径缺失(os error 3,父目录被删)同归 deleted,对齐 wiki.ts 先例;
 *  边界用 \b 防 errno 2x(20/21/24/28…)前缀误判;其余 = io,原文透出。 */
export function classifyProjectReadError(err: unknown): "deleted" | "oversize" | "io" {
  const msg = projectReadErrorMessage(err);
  if (msg.includes("读取上限")) return "oversize";
  if (/(?:os error [23])\b/.test(msg)) return "deleted";
  return "io";
}

/** 错误原文(tauri invoke 拒因为 string,Error 次之,其余 String 化)。 */
export function projectReadErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ── 轮询读缓存(0.4.3 评审 P3:轮询面每拍全量重读,最大 32MB 纯浪费)──────
 * path+mtime 键,值 = 解析产物(name/scenes,坏内容也缓存为 null):mtime 变
 * 即内容变(fsCollectFiles 每拍带最新 modifiedAt),命中零读盘。取舍:
 * - 不带 size:FileStamp 契约在 Rust 侧与 CLI 会话扫描共享,加字段越切片,
 *   mtime 已覆盖内容变更主信号;
 * - 读失败不缓存:IO 可能瞬态,超限/删除每拍重试一次 stat 级闸代价可忽略;
 * - 失效路径:拍内消失的路径删键(被删/改名自愈);prepare(点「AI 会话」)
 *   绕过缓存强制读 —— 会话决策点必须新鲜,缓存只服务轮询展示面。 */
/* N>8 时稳态每拍重读 N−8 项(旋转逐出),非全量失效;16 项目回到与基线持平。 */
const PROJECT_CACHE_MAX = 8;
type ParsedProject = { name: string; scenes: number };
const projectCache = new Map<string, { mtime: number; parsed: ParsedProject | null }>();

/** 查缓存:同 path 同 mtime 回解析产物(null = 已缓存的坏内容);miss 回 undefined。 */
export function cachedAnimProject(path: string, mtime: number): ParsedProject | null | undefined {
  const hit = projectCache.get(path);
  if (hit === undefined || hit.mtime !== mtime) return undefined;
  projectCache.delete(path); /* LRU 触碰:重插队尾 */
  projectCache.set(path, hit);
  return hit.parsed;
}

/** 写缓存:LRU 8 级,满逐最旧(32MB 级文本不入缓存,只存解析产物)。 */
export function putAnimProjectCache(path: string, mtime: number, parsed: ParsedProject | null): void {
  projectCache.delete(path);
  projectCache.set(path, { mtime, parsed });
  if (projectCache.size > PROJECT_CACHE_MAX) {
    const oldest = projectCache.keys().next().value;
    if (oldest !== undefined) projectCache.delete(oldest);
  }
}

/** 显式失效(删键):项目从拍内消失时调用,防陈旧键常驻。 */
export function invalidateAnimProjectCache(path: string): void {
  projectCache.delete(path);
}

/** 列表单行状态:invalid = 内容坏(name/scenes null);too-large = 超 32MB 读取闸。 */
export interface AnimProjectRowState {
  path: string;
  file: string;
  name: string | null;
  scenes: number | null;
  tooLarge: boolean;
}

/** 轮询一拍:stamps → 行状态。readText 供已解码文本(base64 解码半段留在调用方,
 *  本模块保持零依赖)。mtime 未变直接回缓存不读盘(测试锚 = readText 只对 miss
 *  调用);读失败按形态归 too-large,其余失败与坏内容同显「无效项目」,下一拍
 *  自愈;拍内消失的路径顺手删缓存键。 */
export async function readAnimProjectRows(
  stamps: { name: string; path: string; modifiedAt: number }[],
  readText: (path: string) => Promise<string>,
): Promise<AnimProjectRowState[]> {
  const alive = new Set(stamps.map((s) => s.path));
  for (const key of [...projectCache.keys()]) {
    if (!alive.has(key)) invalidateAnimProjectCache(key);
  }
  return Promise.all(
    stamps.map(async (f): Promise<AnimProjectRowState> => {
      const cached = cachedAnimProject(f.path, f.modifiedAt);
      if (cached !== undefined) {
        return { path: f.path, file: f.name, name: cached?.name ?? null, scenes: cached?.scenes ?? null, tooLarge: false };
      }
      let parsed: ParsedProject | null = null;
      let tooLarge = false;
      let failed = false;
      try {
        parsed = parseAnimProject(await readText(f.path));
      } catch (err) {
        failed = true; /* 读失败一律不缓存:IO 可能瞬态,下一拍重试 */
        tooLarge = classifyProjectReadError(err) === "oversize";
      }
      if (!failed) putAnimProjectCache(f.path, f.modifiedAt, parsed);
      return { path: f.path, file: f.name, name: parsed?.name ?? null, scenes: parsed?.scenes ?? null, tooLarge };
    }),
  );
}
