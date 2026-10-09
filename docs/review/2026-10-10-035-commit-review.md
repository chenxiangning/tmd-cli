# 0.3.5 提交批换角度复审(3ae8a..ea0cb,9 commits)

- 日期:2026-10-10
- 状态:已收口(P1×2/P2×2 随评修复,P3 择要修复,余记录;死代码清理随手收)
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
