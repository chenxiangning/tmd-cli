# 近八笔提交全量审核(2026-09-20)

> 日期:2026-09-20 · 状态:已完成(修复随本批提交;门禁全绿,react-doctor 100)

## 范围与结论

8de210e → cde7b03 八笔(open-with 三连 / md 目录 654442f / 侧栏文件浏览器 fe32c18 / 最大化 cde7b03 / 更新感应 8de210e;4fc85d2 纯删文档审查干净)。三个 reviewer 按批次并行审 + 主会话交叉复核 + 二轮换角度复审(审修复 diff 本身)。

裁决:**无 P0;3×P2 + 17×P3,修 16 项,缓修 4 项**。Merge verdict: OK with notes。

## 已修

### open-with(68691bc/b986b48/a33d27b)

|严重度|位置|问题 → 修法|
|---|---|---|
|P1|open_with.rs open_with_app|macOS `open -a App --args … <path>` 路径在 `--args` 后永不被打开(open(1) man 坐实:"These arguments are not opened or interpreted by the open tool")→ 文件参数移 `--args` 前|
|P2|open_with.rs open_app_icon|图标临时文件固定名 `{pid}.png` 在 spawn_fs 多线程并发下互相覆盖/误删(设置面板 N 图标并发提取)→ AtomicU64 序号;顺带 `sips -Z 128` 降采样(数百 KB data URL 永驻缓存 → 小图)|
|P3|open_with.rs|失败错误并入 stderr 首行(原只报 exit code);Windows PS 脚本单引号转义|
|P3|ipc.ts + open_with.rs|`OpenWithProbe.resolvedPath` 死契约字段(全库零消费,probe_command 算了 which 路径就扔)→ 两侧删|
|P3|OpenWithTab.tsx + settingsSanitizeOpenWith.ts|第 33 个添加被 sanitize 静默吞 → `OPEN_WITH_TARGETS_MAX` 导出共享,对话框满员禁用 + appendTarget 双保险|
|P3|OpenWithTab.tsx|dialog effect 依赖内联 onClose,父重渲染会对已开 dialog 重调 showModal → `if (!dlg.open)` 守卫|
|P3|settingsSanitizeOpenWith.ts|非数组回落返回 DEFAULT_SETTINGS 活引用(别名腐蚀隐患)→ 深拷贝|
|P3|OpenWithMenu.tsx|`fallback ?? targets[0] ?? null` 中段不可达 → 简化|

### 侧栏文件浏览器(fe32c18)

|严重度|位置|问题 → 修法|
|---|---|---|
|P2|workspaceBrowserModel.ts changedTreeOf|变更剪枝丢深度≥2 嵌套仓(buildChangedChildren 只从仓根起建,workspace 根→仓根的中间目录不物化;变更视图误报「没有变更文件」而全部文件视图有色)→ 补 base→各仓根祖先链合成,干净仓也补链;changedRootChildren 整函数因此冗余删除;2 条回归测试钉住|
|P3|workspaceBrowserModel.ts|变更视图 localeCompare vs 全部文件视图 Rust 字节序 → 统一码点序 compareNames|
|P3|workspaceBrowserModel.ts filterWalkHits|搜索排除目录靠尾斜杠 split 空名凑巧 → 显式 `endsWith("/")` 跳过|
|P3|WorkspaceFileBrowser.tsx + WsfbBodies.tsx|搜索 walk 满额静默截断 → 假「没有匹配的文件」;空结果改提示「结果可能不完整」|
|P3|FileTree.tsx|折叠目录着色回查只在侧栏(嵌套 untracked 仓右栏无色)→ 右栏补 `${path}/` 回查同口径|
|P3|useTreeOperations.ts|返回值字面量每渲染新引用,下游 rowMenu/body memo 全败(仅开菜单也全树重渲染)→ useMemo 化|
|P3|WorkspaceFileBrowser.tsx|侧栏硬编码 on=true 绕过装饰开关 → 头注文档化设计意图(浏览语义自带装饰)|

### 杂项(654442f/cde7b03/8de210e)

|严重度|位置|问题 → 修法|
|---|---|---|
|P2|markdown-outline.css|`.fvp-preview-outline-disclosure{display:none}` 无容器前缀,误伤共享组件的 PDF/文档预览(书签树永久全展开)→ 限定 `.fvp-markdown-outline-layer` 内|
|P2|FileMarkdownPreview.tsx|空大纲文档仍打 is-outline-collapsed,marks 徽章/详情卡空让位 → `outline.length > 0` 守卫|
|P3|useMarkdownOutline.ts|滚动跟随每 scroll 事件全树 querySelectorAll → effect 建立时快照节点(revealComplete 翻转时重建);激活行查询从 document 收进预览根;头注释漂移清理|
|P3|updateCheck.ts parseAtomLatest|首条 entry 是 rc tag 时(extractSemver 严格三元组拒收)整次检查永久报「格式异常」,后台化后 rc 期账本冻结 → 逐 entry 找下一条可解析项|
|P3|updatePresence/SidebarSettingsCluster/main.tsx|init 绑左栏底簇挂载(左栏关则检查停摆)→ 挪 main.tsx boot;版本占位 0.1.4 期不判 hasNewer(防「有新版」瞬态误闪,version 改 null 态)|

## 二轮复审(换角度:审修复 diff 本身)

RecheckFixes(正确性/回归)+ DeadcodeSweep(死代码/一致性横切)双审工作区修复 diff:修复面零回归、零死代码、缓修项无半修残留。随批补齐:parseAtomLatest rc 跳过回归用例、sanitize 缩进、添加按钮满员禁用、版本回落统一 CHANGELOG 首条、「结果可能不完整」en/ja 词典登记。

## 缓修(记录在案)

1. **Windows 路径分隔符全链路断裂**(存量,右栏 FileTree/git 装饰键同构):正确修法 = ipc/config 边界统一归一分隔符,影响横跨多插件,需 Windows 机器验证,建议专项。
2. 双视图同根挂载轮询翻倍(历史 P2-1):每仓 gitStatus 2×/5s、reposScan 3×/60s;有界 + 失焦暂停,待共享 status store 专项。
3. OpenWithTab targets 引用一变全量重探(≤32 有界)。
4. 窄窗最大化钉宽横向溢出(角落场景,无裁剪兜底)。
5. fs_walk 截断旗标只测 cap 臂:3s 预算超时返回部分结果无信号(慢盘仍可能假「没有匹配的文件」);walk 失败路径也显示「没有匹配的文件」。修法 = fs_walk_files 契约携带 truncated 旗标,wsfb 搜索与 QuickOpen 两消费方同步,随 fs_walk 专项。

## 未发现回归的维度

useDirTree 两调用点语义等价(key 重挂载使 root 撕裂不可达);gitDecorate 拆分单仓路径与旧实现逐项一致;空目录/unborn HEAD/搜索空态/大忽略列表边界;WorkspaceBrowserSwap 无重复初始化;字母 "?"→"U" 口径右栏三处对齐;en/ja locale 对齐零孤儿键;CSS 新选择器全在用;cde7b03 最大化钉宽链(变量/handle/cursor)全核对;4fc85d2 删除干净。

## 验证
typecheck / vitest 2699 / arch-boundary / file-size / build / cargo test 257 + clippy -D warnings + fmt / react-doctor 100,全绿。
