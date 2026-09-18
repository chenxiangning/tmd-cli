# 近 20 笔提交整体 code review(f675e49..1793617)

- 日期:2026-09-19
- 范围:0f6131e..1793617 共 20 笔(97 文件 +6925/-359):marks 插件五连、kernel 宿主注册表、git 工具条四连、yn 复刻三连(md 快路径/语言 25 家/全文搜索)、perf 批次三连、平铺门控与 checkpoints 身份回填修复。
- 方法:五路 reviewer 并行深评(marks+宿主注册表 / git 工具条 / yn 复刻 / perf 批次 / 跨领域冗余兼容),全部发现对照 HEAD 核实后整改;整改与门禁同批收口。

## 结论(先行)

**P0×1 + P1×2 + P2×8 + P3×19;P0/P1/P2 当场全修,P3 修 15、缓修 4。** 最重一笔是 2c58d44 把 `fs_walk_files` 从 Tauri invoke_handler 误删——桌面端 composer @ 补全、提示词资产库、/ 命令与 skill 候选、⌘P 快开全部静默失效(消费方 `.catch(() => [])` 吞错 + 两条测试链路看不见注册面,功能测试测不出)。marks 域实现质量最高(持久化协议/拆包红线/退订完整性均干净),缺陷集中在状态机边角与 i18n 纪律。

## P0(合并阻断,已修)

| 位置 | 问题 | 修复 |
|---|---|---|
| src-tauri/src/lib.rs | `fs_walk_files` 被 `fs_search` 顶替出 invoke_handler(2c58d44 本想新增却写成整行替换);桌面 invoke 报「命令未注册」,fileIndex/assets/mdCommands/skillDirs/scanSuggestions/QuickOpen 全空 | lib.rs 补回一行注册;generate_handler 编译期校验命令存在,crate 编译通过即注册生效 |

## P1(已修)

| 位置 | 问题 | 修复 |
|---|---|---|
| search/SearchPanel+QuickOpen | search 直导 `@plugins/files/openFile` —— 全仓唯一插件互导,违反「插件零直接依赖」铁律(02-code-architecture:109),与 marks 同窗落地的 openTab 深链范式自相矛盾 | openFile 上移 `kernel/fileTabs.ts`(openFileInTab/openFileAtLine/takeFileRevealLine),files/search/marks/git 四方同改走 kernel;git FileRowActions 内联 openTab 与 marks openAndReveal 一并收编 |
| cli-codex/sessionStatus.ts + cli-shared/sessionStatus.ts | codex 尺寸闸黏滞 path:resume/fork 产生**同 id 新 rollout 文件**(闸键不变)且旧文件不再写 → 每拍短路,resolvePath(取 mtime 最新)永不再执行,resume 后 /model 切换永久不反映(66599b9 新引入;claude/qoder 直拼路径、omp/pi resume 换 id 不受影响) | readStatusTailGated 增 `revalidateMs` 参数(默认永不),codex 传 30s 强制重定位一次自愈;直拼型零行为变化 |

## P2(已修)

| 位置 | 问题 | 修复 |
|---|---|---|
| useComposerSend.ts + marks/sendTransform.ts | 平铺广播多路发送:transform 有副作用(首调翻 sent),逐路重跑 → 引用块只进第一路,其余幕布静默丢失且芯片已消失 | 广播分支 transforms 单次化:共享一份变换文本,各路差异仍由 prepareSendPayload 按目标处理 |
| kernel/terminalLinks.ts | 命中区间按字符下标直接映射 xterm 单元格列,中文前缀行(本产品高频)点击区右移 N 格 | charCellMap 字符→起始 cell 映射(宽字符占 2 格、续格空串),命中才建表零常驻开销;新增 CJK 回归测试 |
| marks/widgets/editorExtension | 跨工作区打开的文件 tab:runtimeMarks/动作/重定位全取活跃工作区桶,按钮静默失效、指纹重定位停摆 | owningCwd 最长前缀归属(无归属回落活跃区);MarkRuntime 携带 cwd,动作直落所属桶 |
| marks/terminalLink.ts | 回链 `startsWith("/")` 误判 Windows 盘符/UNC;parseMarkRef 不支持含空格路径 | ABS_PATH_RE(POSIX/盘符/UNC)+ 正则空格段支持 + 空格路径须含分隔符后过滤;openAndReveal 委托 kernel openFileAtLine(获光标定位) |
| search/SearchPanel.tsx | 在途搜索(可至 3s)无序列守卫:输入清空后旧 IPC 晚到回填旧结果;busy 期间 Enter 被吞 | seqRef 请求序守卫(resolve/reject/finally 三处校验),busy 不再拦截新回车(仅 spinner) |
| git/GitToolbar.tsx | totals 未就绪(首开/切仓/拉取失败)时聚合 span 整体卸载,按钮组跳位 | mr-auto 移除,ml-auto 挂恒渲染的视图钮 |
| Windows 双 tab(根因) | 搜索/快开拼 `/` 与文件树原生 `\` 分叉,tab id 精确串比较 → 同文件双 tab、定位通道失效 | kernel/fileTabs 入口统一 normalizePath(树/搜索/快开/marks/git 全走同一入口);macOS/Linux 恒等无影响 |
| marks i18n 整族 | 全部 UI 词条无词典(插件词典纪律唯一违例);panel 三处模板串动态键永不可译;widgets 硬编码中文 | marks/locales.ts(en/ja 35 键)+ t() 全覆盖;面板头改占位参数键;状态文案 STATE_LABEL 统一 t() 且随 file-mark:changed 载荷下发(files 侧零 marks 语义 import) |

## P3(已修 15)

- git/RemoteRows:孤儿分隔线删除、has-state 死类删除、行补 role=menuitem;触发钮补 aria-haspopup/aria-expanded
- git/index.tsx:git.fetch/pull/push 命令 title 包 t()(词典键 en/ja 已在 git2:197-199,此前未接线)
- repoDisplayName/PushPreviewColumns:cwd.split("/") 在 Windows 取不到末段 → 双分隔符正则
- marks/store:isMark 补 state 枚举校验 + excerpt 缺省补空串(旧条目不蒸发,sendTransform 不再被脏盘砸断);loadAllMarks 改按 id 合并(读盘窗口内落锚的内存标记不被覆写);relocate exact 命中时 lost/drifted 恢复 pending(undo 回原位不失联永久化)
- marks/widgets:NoteWidget.eq 补行号(drifted 再漂移卡片标签不滞留);staged 动作文案与面板统一「↩ 撤回」;placeholder 双版收敛词典
- FileCodeEditorImpl:工厂同步抛护栏(Promise.resolve().then 包装,单厂同步 throw 不再吞掉整组扩展)
- fs_search:行游标切行(\n 与独立 \r 都断,CRLF 合一 —— naive 双谓词 split 会拆出幻影空行,行号错位,测试实证);交付信封 {hits, truncated},预算耗尽/满额 UI 提示(替换只看上限的旧提示)
- fastPath:缓存键拼入界面语言(fence renderer 把 t("复制")烧进缓存 HTML,切语言不得回放旧按钮)
- syntax.sanitizePrismHtml:on*= 剥除限界到未转义标签内部(代码示例正文里的 `onclick=` 字样原样保留)
- previewMarks:原始状态枚举改渲染载荷 stateLabel
- search/overlayStore:手写 subscribable 换 kernel createSubscribable
- 注释漂移 ×4:plugin.ts/Composer.tsx inputRail 左下横排、RightPanelToolbar header.right 有贡献者、sessionTabs tile 与数量解耦

## 缓修清单(4,均 P3)

1. **md 预览态定位行无消费方**(FileTabContent md 分支不接 revealLine):搜索命中 .md 文件在纯预览态零反馈;需贯通 react-markdown 与 fastPath 两条渲染路径的块级滚动,放下个版本。
2. **StrictMode 双挂载把 marks reveal 一次性消费**(editorExtension queueMicrotask):仅 dev 态新开 tab 回链不滚动,生产不受影响;files 同类坑已设防,marks 留待短窗保留方案。
3. **guide/非仓态触发 git.fetch/pull/push 命令**:绑键后在多仓 guide 态按键,选仓后对话框突弹;when 加仓可用判断即可,场景边缘。
4. **cli-codex/edits.ts locateRollout 同款黏滞**:批前既有行为,不属本批回归;若 codex 编辑面板出现同类陈旧,参照 sessionStatus 的 revalidateMs 方案收编。

另:git aheadBehind 切仓瞬时陈旧(亚秒级)接受;setGitAggregate「值不变不 emit」注释与引用判等实况的偏差,随下次触碰顺手校正。

## 未发现问题的维度(各路核实)

- marks 持久化主干(墓碑/防抖/last-write-wits/fs_write_file 策略)、拆包红线(@codemirror/* 全 type-only)、贡献退订完整性、terminalLinks 越界过滤
- fastPath XSS 面(html:false 全转义、validateLink 拒 javascript:/data:、嵌套栅栏与 $ 定界逐例对齐)、缓存键碰撞、大文件分片
- fs_search 二进制嗅探/大小写贯通/symlink/权限错误/spawn_blocking;语言包动态拆 chunk 与回落
- perf 批次:截断判变、configHomeDir 拒绝复位、codex 拆分逐位对齐(model 兜底数学等价)、平铺门控根治、身份回填幂等与锁序
- CSS 死代码/样式翻修残留/契约删除残留/明暗主题/px-rem/依赖合理性(+9 全 MIT 微包)

## 验证

`pnpm typecheck && pnpm test`(1709 全绿,较整改前 +1 条 CJK 回归)`&& pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `npx react-doctor@latest` **100/100**;Rust 侧 `cargo test`(249 全绿)`&& cargo clippy --all-targets -- -D warnings && cargo fmt --check` 全过。fs_walk_files 注册由 generate_handler 编译期存在性校验背书。
