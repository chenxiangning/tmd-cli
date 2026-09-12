# 后台会话「等待确认」不出现:字节通道结构性漏检评审与屏幕镜像修复记录

- 日期:2026-09-11
- 状态:已完成(修复在工作树,未提交)

## 症状(用户报告)

前一日修复(webview 重载幽灵会话 readopt)实测未解决:会话行的「等待确认」徽章只有打开该会话的 tab 之后才出现;tab 未打开的后台会话从不出现。

## 根因:字节通道对 omp 整帧重绘面板结构性失明

屏幕态通道(v3)依赖 TerminalView 挂载才能采样,后台会话只剩字节通道;而字节通道的「逐 chunk 末尾取 1024 字符尾窗、剥 ANSI 后认末 5 行」评估方式对真实 omp 字节流原理性漏检:

1. **标记埋在帧中部**:omp 等 pi-tui 系 TUI 以整帧光标寻址重绘,Ask 面板标记(Enter select / Other (type your own))后面还跟着提示框、状态栏、mc 行等数行内容;Rust 泵按批 emit(实测帧 2-9KB),onOutput 只在 chunk 末尾评估一次,chunk 末尾永远是屏幕底部行而非面板标记。
2. **日志回放实证**:取本机会话日志(omp,tmd-cli 工作区)含 4 个 live Ask 面板的 2.7MB 真实字节,以 313B/1KB/4KB/8KB/16KB/64KB 六种批粒度回放真实 AskWatch:≥4KB(贴近真实批粒度)全部零命中;细粒度偶发命中也因页脚无字面量、守望自愈条件达成被摘除。
3. 单元测试未覆盖:既有用例的合成 chunk 均把标记放在 chunk 末尾(标记天然在尾窗),真实流形从未被回放过。

重载场景(bootAskRestore / readopt 路径)同样受害:恢复喂入的磁盘日志尾以状态栏增量收尾,页脚窗无标记,立不了候选 —— 与用户「实测没有修复」一致。

## 修复:headless xterm 屏幕态镜像(askWatch v3.1)

屏幕(幕布)是唯一不依赖标记重现位置的 ground truth,前台已验证可靠;缺的只是后台采样源:

- 新增 `kernel/askScreenMirror.ts`:每条活 CLI 会话养一个 headless xterm(80×24,scrollback 0),appendOutput 同流字节同步写入;1Hz 采样底部 8 行喂 onScreenSample,与 TerminalView askProbe 同口径。幕布挂载的会话(getTerminalHandle 在场)让位真实采样,互斥防双源打架。不接 resizeSession:标记贴状态栏上方,80/120/200 列镜像实测都落底部 8 行窗内。
- **readopt 后补底**:镜像新建无历史,重载前已挂起的面板要等整帧重绘才可见 —— readopt 接管后逐会话读磁盘日志尾(256KB)回放进镜像(`backfillFromDisk`;磁盘字节与幕布回放同源,不经 appendOutput,守 diskReplay 红线)。补底与实时字节重叠区容忍(面板帧绝对寻址,后到覆盖先到)。
- `hostWatches.appendOutput` 同流喂镜像(未知会话按 CLI 处理);`onSessionRemoved` 随会话消亡;`resetActivityWatchForTest` 一并归零。
- 字节通道原样保留(claude 等 TLS 纯文本流的确认句式仍走它),不改阈值。

镜像保真前提同样用真实字节验证:真实面板存活区回放进 headless xterm,底部 8 行与用户截图画面逐行一致(面板框 + Enter select 页脚 + mc 状态行),标记连续在场跨过 1.2s 防抖。

## 顺手修正

- `askWatchCore.resetForTest()` / `askWatchFeed.resetForTest()` 补清 `lastWriteAt`:用例 id 复用(测试 ipc mock 数组重置)+ 假时钟每次 reinstall 回拨,上一用例的写后抑制窗在下一用例变成永久闸 —— 既有 askWatch.host.test 4 用例被此潜伏缺陷间歇打断,实测根因。

## 验证

- 新增 `askScreenMirror.host.test.ts` 4 用例:整帧重绘面板(字节通道零命中的形态)经镜像置位等待 + askDetected;幕布挂载让位/卸载接管;移除不复活;readopt + 磁盘尾补底置位(重载幽灵回归)。
- `askWatch.host.test.ts` 文件头声明专钉字节通道契约,整体 vi.mock 屏蔽镜像(镜像契约归 askScreenMirror.host.test.ts),消除双通道互相污染。
- 真实字节回放探针:2.7MB 含 4 面板区域,修复前 6 种粒度全不亮/不自愈保持,修复后 headless 镜像在场判定与真实屏幕一致。
- 桩目检(1421 dev + Tauri 桩):session_list 给后台 omp 会话、日志尾给挂起面板帧 → 应用启动后不开 tab,侧栏行 ~4s 出现「等待确认」徽章(DOM 断言 `.thread-ask-badge` 命中)。
- 全量 `pnpm typecheck / test(1486)/ check:arch-boundary / check:file-size / build` 绿。

## 残余权衡

- 镜像尺寸固定 80×24,不联动 resizeSession:极端宽度差下面板 reflow 理论上可把标记挤出 8 行窗(实测 80/120/200 列均未复现);若日后复现,在 host.resizeSession 挂一行镜像 resize 即可。
- 重载后镜像补底依赖磁盘日志尾 256KB 内含最后一帧整帧重绘;若重载前面板静默超过该窗且 omp 不再整帧重绘,徽章推迟到下一次整帧重绘(实测 omp 周期性整帧重绘,窗口足够)。
- 慢速流式输出期间,transcript 里的历史面板框短暂驻留底部 8 行可能晚亮早摘(1.2s 防抖 + 消失自愈兜底),与前台幕布采样既有语义一致,未额外设闸。
