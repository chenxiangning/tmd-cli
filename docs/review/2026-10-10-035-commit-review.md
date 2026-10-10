# 0.3.5 提交批换角度复审(3ae8a..ea0cb,9 commits)

- 日期:2026-10-10
- 状态:已收口(P1×2/P2×2 随评修复,P3 择要修复,余记录;死代码清理随手收);同日续批补审前 5 笔图标装饰批(b42dfdb3..64fa4387)并清账词典跨域撞车存量,见文末「续批」
- 方法:两路 reviewer 子代理并行分片(intent-canvas 保存链 / 图标装饰卡)+ 主审亲证 journal 直写、reveal 口径、版本源与死代码清扫;发现全部基于现态全文与错误链实证,禁凭 diff 猜测。

## 发现与裁决

### P1(真 bug,已修)

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 1 | intent-canvas/storage/paths.ts isMissingFileError | 只认 not found/no such file/does not exist 三模式;Rust read_file 缺失文件报「读取文件信息失败: {os 文案}」,Windows(EN「cannot find the file specified」/zh「系统找不到指定的文件」)全不命中 → 新建画布保存、索引首读、AI 导入兜底在 Windows 全断(0.3.5 之前即断,本机 macOS 测不出;两个测试文件内存桩手抛文案永远测不出) | 增补 os error 2(双平台语义恒 ENOENT/ERROR_FILE_NOT_FOUND)/cannot find/找不到 三模式;新增 paths.test.ts 回归钉(Windows EN/zh 识别 + 权限/超限不误判)。Rust 结构化哨兵列为后续更优解 |
| 2 | kernel/locales {en,ja}/settings.ts「关闭」跨域撞车 | settings 域译 Off,common/git/cli/composer 四域译 Close,i18n 合并后到覆盖,notify 插件 activate 期 registerMessages 再以 Off 胜出 → en/ja 下全 app 30+ 处「关闭=Close」语义位(TopBar 红绿灯 aria、各弹窗关闭/取消钮、错误条消散钮)显示 Off/オフ。缺陷先于本批;本批图标卡恰因该意外胜者才显示正确 On/Off | 开关语义整体迁移专用短键「开/关」(kernel settings 域登记 On/Off·オン/オフ;7 处开关段迁移:BehaviorTab×2/BasicAppearanceTab/HygieneCard/IconDecorCard/notify SoundSettingsCard/wallpaper×2);notify 词典删 开启/关闭 覆盖键;kernel settings 影子词条 开启/关闭 删除 → 全局「关闭」回归 Close |

### P2(已修)

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 3 | intent-canvas/storage/documents.ts rollbackDocumentWrite | check-then-act 非原子:gate 过后、回滚读核对与写恢复之间可被并发 AI 导入插入,恢复旧字节反而覆盖导入图形——制造它要防的数据丢失 | 保存整段(覆写闸 + 文档写 + 索引更新)挪进 withIndexTx,两写方全串行,两类交错从结构上消失;回滚核对注释降级为「兜外部写方」 |
| 4 | 同上 回滚自身失败象限 | 新建画布 + fsRemovePath 失败(杀软/同步盘锁)= 盘上孤儿 + 索引无条目,重存恒被 stale 闸拦死,无应用内恢复路径,与「下次保存自愈」注释矛盾 | orphanClaims 模块表:回滚失败记「路径 → 本次写入字节」+ console.warn;readPriorDocumentRaw 凭全等字节认领自家孤儿放行,认领即清账;补测试钉全链(warn/半写态/重存自愈) |

### P3(择要修复)

- 排序比较器 updatedAt 相等两方向同返回破坏反对称 → compareIndexEntries 平局 id 决胜(documents.ts 读侧 + indexWrite.ts 写侧;并列条目影响剥缩略图次序、AI 作画缺省目标、时代分组)。
- embeddedBytes 估式 2 空格前缀 vs 实际 4 空格缩进、漏条目间逗号 → 前缀改 4 空格,注释降为「恒定微低估,最终整档精确复检兜底」。
- checkpoints BatchRowParts 打开文件/位置双钮未挂装饰钩子(与 git FileRowActions 同钮异治)→ data-action-id + DecorIcon 接入,色/闪烁/组合与 git 侧全对齐。
- DiffModeToggle 三处裸 svg 换 DecorIcon(git-diff-tools 组合切换真实生效);git-row-actions/git-repo-ops 为文本钮,清单加注「预览字形仅示意,色/闪烁两生效」。
- 图标卡分组无可达性语义 → 组标签加 id + 网格 role=group aria-labelledby。
- 回滚链分支零测试 → 补 3 用例(索引写失败回滚、回滚自身失败孤儿认领自愈、删除遇坏索引不整表覆盖)。

### 记录不修

- deleteIntentCanvasDocuments 先 trash 后更新索引且无回滚,索引失败留幽灵条目(用户再删自愈);与保存侧事务性不对称,等真实反馈再决定是否补删除事务。
- intent-canvas 索引读侧 sort 与写侧已统一决胜,eraGrouping 输入契约随之确定,无须再改。
- 词典重复键无 lint 把关(en/index.ts 仅注释),建议后续补 CI 查重脚本(本次「关闭」撞车即其盲区产物)。

## 死代码清理

- icon-decor.css:wsl-panel 底栏/菜单行选择器 4 行(rail 化前历史遗留,css 注释自认无消费方;wsl 插件 rail:true 被 SidebarSettingsCluster 排除在底栏/菜单之外)。
- kernel locales settings.ts 开启/关闭 影子词条(删键后无消费方)。
- notify/locales.ts 开启/关闭 覆盖键(见 P1-2)。
- 复核无残留双份:LadderIcon/COLOR_PLACEHOLDER/ICON_SETS/_itemsCoverAllKeys 全仓单份;旧 IconDecorCard 平铺清单无引用;git-open-location 规则无重复定义;mobile-app/src-tauri 无版本源(仅 gen);WorkspaceRowMenu reveal 走 run() setError 已有错误面,不属静默吞。

## 验证

typecheck、vitest 488 文件 / 3801 测试(含新增 paths.test 3 例 + storageTransaction 3 例)、check:arch-boundary、check:file-size(documents.ts 306 行超限随评拆出 storage/indexWrite.ts 后全绿)、build、react-doctor 100;1421 桩目检:图标卡 开/关 段上屏、六组 role=group aria 关联就位。

---

# 续批:前 5 笔图标装饰批复审 + 词典跨域撞车清账(2026-10-10)

- 范围:b42dfdb3、a284d4d1、82c6231e、38e37a60、64fa4387(0.3.5 前 5 笔,上批未覆盖)+ 全 kernel locales 撞键存量
- 方法:两路 reviewer 并行(kernel+files / git views)+ 主审亲证;词典撞车以全域对扫实测取证

## 复审结论:图标装饰批零 P1/P2

六个疑点全部有证据排除:拆表(iconSetTablesLucide)单一解析出口、测试活注册表全量循环无弱化(_itemsCoverAllKeys 编译期钉 47 键)、en/ja settings2 同构、files 两态矩阵四级自洽(关态不吃装饰色/呼吸仅 is-active)、`#4da3ff` 为 82c6231e 有意选定(right-panel-toolbar 先例)、菜单钩子按 `data-decor-from` 属性命中零泄漏、worktree 新旧键选择器集不相交无迁键问题。

## P3 修复(随批)

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 1 | GitToolbar git-view 钮 | data-action-id 挂钮上,装饰色/呼吸染到「变更/历史」文字标签,偏离 LeftRail「attr 挂 svg」约定 | attr 挪 DecorIcon svg(LeftRail 先例),文字标签回归本色 |
| 2 | checkpoints BatchRowParts 双钮 | `text-(--tmd-fg-subtle)/hover:text-(--tmd-fg)` 被 icon-decor.css 未分层规则级联顶掉成死类 | 删死类名,接受与 git 面板行钮一致化(缺省 muted) |
| 3 | WorktreeZone 段头 + AggregateReposView 聚合头 | 新建工作树/刷新/刷新/拉取全部/▾ 五钮无装饰钩(漏网清单) | 按钮内 svg 挂 `data-decor-from`(git-worktree ×2 / git-repo-ops ×3);currentColor 回落继承钮色,缺省观感零变化 |
| 4 | DiffView 树形 +/− 钮 | title/aria 裸英文 `unstage`/`stage` | 走 t(「暂存」/「取消暂存」),git 域补 en/ja 词条 |

记录不挂:DiffBatchBar 三钮为纯文本钮无字形,不属图标装饰系统 scope(同上批「文本钮清单加注」口径);BranchView 域挂钩需另立语义键,待真实需求。

## 词典跨域同键异值存量(21 行/16 键,全清)

盲区与上批 P1-2「关闭」撞车同类:locales/{en,ja}/index.ts 裸 spread 合并,同键异值后者静默覆盖前者。全域对扫实测 21 行冲突,逐键定裁决:

- **统一译值**(合并态不变或修正 casing):未知(Unknown)、当前(Current)、重命名、重命名…(省略号)、刷新(更新)、默认(既定)、已复制(コピーしました)、会话尚未落盘(、)
- **拆键消歧**:新建 → workspace 留「新建」(Create/作成),assets 改用既有「新建提示词」;重新检测 → mobile 拆「重试检测」(gate 重试语义)
- **删死键/重复域条目**:settings2「SSH 连接」、common「还原」、git「{n} 个文件」、mobile「二进制文件」(GitScreen 调用点自带括号,值内括号实为 en/ja 双括号渲染 bug,一并修「无差异」「无法获取差异」两键)
- **防回归**:locales.test.ts 新增跨域同键异值为零断言(引全部 34 域文件,按 index.ts spread 序对扫),实施前红 21 行、清账后全绿

## 验证

typecheck、vitest 全套(locales.test 6/6 含新撞车断言)、check:arch-boundary、check:file-size、build 全绿;react-doctor HEAD 基线 100(worktree 对照法;工作区另有并行在途改动不属本批);1421 桩目检:git-view 装饰色只染 svg(span 保持 --tmd-fg)、WorktreeZone 段头五钩同吃装饰色、新键「新建工作树」上屏。
