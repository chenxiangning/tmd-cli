/**
 * anim · tmd-anim 项目文件面(纯函数,无 ipc 依赖)。
 *
 * tmd-anim 的项目磁盘布局:~/.tmd-anim/projects/<id>.json,单文件即一项目,
 * 形状 = { version: 1, name, canvas?, scenes: Scene[] }(tmd-anim src/core/types.ts)。
 * 本插件只做最小解析(取 name 供展示),容错优先:解析失败显示「无效项目」,
 * 绝不崩;协议知识(~/.tmd-anim/protocol/*)归 tmd-anim 侧同步。
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
 *  语义对齐 tmd-anim 0.1.6 buildAiPrompt:配音超长自动延长不截断、validate 带文件参数、
 *  TTS 按平台分支(Windows 走 PowerShell System.Speech)。具体路径不入正文:引用文件在
 *  确认窗里以卡片预览,启动后挂 composer 卡片,发送时经 animRefsSendTransform 拼回 wire。 */
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
    "先阅读随附引用文件中的协议材料(schema 与小黑风格包),严格遵守其中约定。",
    "按用户后续要求修改随附的目标项目文件;只改目标项目文件,保持 schema 合法。",
    "需要「小黑 / 手绘 / 怪诞 / 正文配图」风格时,先读小黑风格配方与活例再动手。",
    "协议目录下的 http-example.json 是覆盖全部元素类型的完整活例(大文件,按需选读,不必全文读)。",
    "用户需要配音/背景音乐时,给对应场景加 audio 字段(协议 schema 已定义:",
    "src 为音频文件 dataURL,volume 0-2;音频有效时长超过场景时长时,场景自动延长到配音结束,不会中途截断)。",
    "音频一律本机生成,不要访问网络下载(本环境不保证外网可达):",
    ...tts,
    "提示音/简单旋律用 python3 脚本直接合成 WAV;最后把文件 base64 拼成 dataURL 写入 audio.src。",
    "每轮修改完成后:建议用户在 tmd-anim 应用里查看效果;",
    "如需自查,可在 tmd-anim 仓库目录内运行 `pnpm anim validate <目标项目文件路径>`",
    "(该命令只在 tmd-anim 仓库内可用,其他目录运行无意义)。",
  ].join("\n");
}

/** 确认时挂到会话 composer 的引用卡片(协议材料 + 目标项目,label = i18n 源键)。
 *  清单对齐 tmd-anim protocolSync 投递面(0.1.5+ 已不投递 bpe-example.json);
 *  http-example.json 体积大(数百 KB),不挂卡只进 prompt 正文按需提及。 */
export function animSessionRefs(home: string, projectPath: string): { label: string; path: string }[] {
  const protocol = `${home}/.tmd-anim/protocol`;
  return [
    { label: "协议 schema", path: `${protocol}/schema.md` },
    { label: "小黑风格配方", path: `${protocol}/xiaohei-style.md` },
    { label: "小黑风格示例", path: `${protocol}/xiaohei-example.json` },
    { label: "目标项目", path: projectPath },
  ];
}
