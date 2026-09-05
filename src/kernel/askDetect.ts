/**
 * Ask 检测原语与阈值常量 —— 自 askWatch.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:标记正则、ANSI 剥离、页脚窗口截取、全部时间窗/字节阈值。
 * 状态机(候选确认制)在 askWatchCore.ts;host 接线在 askWatchFeed.ts。
 *
 * 检测三件套(与 askSound 世代等价):1024 字符原始尾巴跨分片拼接 → 剥 ANSI →
 * 页脚窗口(末 5 行)内跑保守标记正则。
 */

/** 通用 Ask/确认标记:跨 CLI 的选择/确认句式(y-n 提问含大小写与方括号变体、
 * Do you want 句式)。CLI 私有卡片字面量(omp/pi-tui 的 "Ask N questions"/
 * "Other (type your own)" 等)由 CliProfile.askMarks 声明 —— 内核不理解
 * CLI 私有格式(R 系铁则),私有标记属插件。
 * 选词位置原则:标记必须出现在面板的「尾部」—— 长选项会把面板头部推出
 * 尾窗(实测:omp ask 面板的 "Ask 1 questions" 头部在选项渲染后距尾窗数行,
 * 永不命中),底部字面量才稳定落在页脚窗口。 */
export const ASK_MARKER_RE =
  /[([][yY]\/[nN][)\]]|Do you want/;

/** 页脚窗口:标记只认剥 ANSI 后的末 5 行 —— 面板标题+选项区的高度上限。 */
const FOOTER_WINDOW_LINES = 5;

/** ANSI 转义序列(CSI/OSC/单字符)——ansi-regex 同款成熟模式,只剥转义不伤可读文本。 */
const ANSI_RE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)?)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

/** 尾巴长度:覆盖标记短字面量的跨分片拼接。240 被实测证伪 —— omp 等宽面板
 *  TUI 单行可达 110-180 列(含边框/衬垫),240 字符装不下两行,面板底部字面量
 *  永远进不了页脚窗口(漏报根因之一)。1024 ≈ 宽行 TUI 的 5 行页脚窗口。 */
export const RAW_TAIL_CHARS = 1024;

/** 候选确认窗:升级等待要求标记在后续帧复现且距首击不小于此值。
 *  真面板从出现到被人作答远长于此;残影/回放的瞬态文本撑不过一次输出续流。 */
export const ASK_CONFIRM_MS = 1_200;

/** 候选撤销缺口:距上次标记命中流出超过此字节数仍无复现,候选撤销。
 *  按"单次脱窗即撤销"被仿真证伪 —— 整帧重绘 TUI 一帧 ~8KB,帧内流式推进时
 *  标记只在帧尾进窗,命中/脱窗逐 chunk 交替。omp 整帧 ≈8KB,16KB 容忍两次
 *  帧距;残留/回放文本一旦随流远去,16KB 内必然无复现。 */
export const ASK_CANDIDATE_MAX_GAP_BYTES = 16_384;

/** 候选确认漂移上限:命中后允许累计的新输出 UTF-8 字节数(守望计时器判据)。
 *  omp 交互面板光标停住后不再重绘,标记会被 spinner/状态栏细水长流挤出尾巴
 *  —— 确认只能看流量。实测(3h 挂起面板的真实会话日志):等待期 spinner
 *  ≈10Hz×313B ≈ 3.1KB/s,首个合格 tick(≈2s)漂移 ≈6.2KB;omp 整帧 ≈8KB,
 *  16KB = 两帧余量;真实响应流 2s 内远超此值。慢速响应夹带标记的误升级面
 *  与阈值无关(由等待自愈兜底:响应结束静默 2s 且尾巴无标记即摘)。 */
export const ASK_CONFIRM_MAX_DRIFT_BYTES = 16_384;

/** 写后复燃抑制:作答后此窗口内的复现不升级 —— 已答面板块会随整帧重绘在
 *  屏幕上逗留数秒(transcript 里同样含标记字面量),响应流将其推出屏幕后
 *  复现自然停止。活面板持续重绘,抑制期一过即升级(连续多问只是延迟亮标)。 */
export const ASK_REARM_SUPPRESS_MS = 8_000;

/** 自愈静默阈值:等待会话输出静默超此值且尾巴无面板字面量才摘残签
 *  (与 activityWatch 的轮次静默同语义,常量各自持有以解耦)。 */
export const ASK_HEAL_SILENCE_MS = 2_000;

/** 剥离 ANSI 转义,只留可读文本用于标记匹配。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** 取剥 ANSI 后文本的页脚窗口(末 5 行)。 */
export function footerWindow(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-FOOTER_WINDOW_LINES).join("\n");
}
