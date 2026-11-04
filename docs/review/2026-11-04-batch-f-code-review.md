# 2026-11-04 减法批次 F 代码评审(4c589188)

结论:F-01~F-04 四项全部落地合规,无 P0/P1/P2,本轮零代码修复。全链 gate(627 文件/4820 测试)+ react-doctor 100 绿。真机目检(设置七导航组/远程落地页三态/恢复精简布局)与 A~E 批共用一次目检窗口。

评审对象:`4c589188 refactor(subtraction): 批次F收口` 46 文件 +715/-42;对照 implementation.md §7(F-01~F-04)逐条验收。工作区净,分支 tmd-0.4.9 ahead 11 未推送。

## ① 功能实现准确性 / 架构契合度

- **F-01 新建来源统一分组**:会话菜单「远程来源」组头随注册表显隐(`host.getMount("workspace.newSessionMenu")` + useHost 反应式),entryContract ⑤ 钉死空注册表不空挂组头;WSL 不重复放行(走来源工作区 origin 适配);SSH MenuEntry 零改(归组在宿主侧)。添加工作区对话框「本地来源/远程来源」双组头,远程组头随 origins 出现。
- **F-02 右栏「远程」落地页**:三态决策收敛 `resolveRemoteHome` 纯逻辑,契约四段——SSH 会话优先(运维现场)、WSL 只看 workspaceOrigins 认领 + wsl 元数据、纯本地不误认、**孤儿工作区(来源未认领)不泄漏**(同孤儿判定纪律)。面板 id 保持 `ssh`(persisted 钉住与 ⋯ 勾选值不迁移),label「远程」键入 en/ja 词典;SSH 会话在场时整页交回 SshPanel(连接卡/转发/SFTP 零重构);WSL 段跨插件 import 限 `getWslProbedBins` 纯读探针缓存(先例 checkpoints→approval-inbox 同款),wsl 禁用自然回落空态;`openWslPanel` tab id 与 wsl 插件自身动作逐字一致(wsl:panel,不会开两颗)。wsl rail 动作 `defaultPinned:false` + 中央 tab 保留。
- **F-03 设置七导航组**:`navGroup` 可选元数据进 settingsRegistry(不改 section 唯一性/删除语义);七组常量 kernel 侧,归并纯逻辑 `groupSettingsSections` + 契约三段(组定义序/空组不渲染/归并前后 id 多重集相等);未知/缺省 navGroup 平铺兜底 = 回滚语义(旧插件注册不丢);深链 `openSettingsPanel({section,tab})` 自动展开目标组,section/tab id 与深链契约零改动;**生产 section 归组全量扫描零遗漏**(唯一兜底位出现在测试/桩文件);CSS 拆 settings-nav-groups.css 守 300 行铁则,颜色全走 --tmd-* 变量;组头 aria-expanded 可折叠。
- **F-04 系统组归位与恢复精简布局**:`resetPinnedToProductDefaults` 只写 `tmd.filePanel.pinned.v1`——kernel 契约测试双段钉死:多余 id 清除(已注册默认 ∪ rail 动作默认为真源)、autopin 留痕/主题等其他 localStorage 零波及;`railPinDefaults` 登记表补 rail 动作默认真源(rail 动作不进 state.panels 的结构缺口);LayoutResetCard 用户主动 ConfirmDialog 确认 + role=status 结果反馈;**顺带修真缺陷**——sidebarActions `registerSidebarAction` 此前硬编码 `true` 使 `defaultPinned` 声明位被无视(字段早已存在但从未生效),现接通并有测试;session-budget 显示名统一「列表配额」(en/ja 同步,旧键「会话列表预算」「会话列表显示预算」死键清除);网络代理保留右 rail 动作,SSH 设置页给说明(措辞对插件禁用态成立)。

## ② 兼容性

- 不动:面板/section/tab id、深链契约、persisted 钉住清单、预算值、代理值、russh/known_hosts/SFTP/UNC 迁移。
- 预期行为变更(计划内):SSH 右栏面板更名「远程」(SSH 会话在场时内容原样);WSL rail 动作默认不钉(⋯ 菜单可勾回,中央 tab 不受影响);设置左导航组化(默认全展开);「会话列表显示预算」文案改「列表配额」。
- 回滚面:navGroup 元数据可保留无副作用(平铺兜底);恢复布局后回滚代码不擅自再改写用户已确认的清单(重置是显式用户动作)。

## ③ 性能

- 归并走 useMemo(sections 引用稳定);组折叠本地 state;无新增订阅/轮询;重置为单次用户触发全量覆写。

## ④ 死代码清理

- 「会话列表预算」「会话列表显示预算」键随改名同步清除(en/ja 无死键残留,i18n 比对绿);SshPanel 无重复实现;navGroups/remoteHome 纯逻辑单源。
- 已知无害冗余:「列表配额」同时注册于 session-budget 域与 kernel settings3(值一致,合并词典不冲突)。

## 验证

- `pnpm check:gate`:627 测试文件 4820 测试(较 E 批 +2 文件 = F 新增 navGroups/remoteHome 契约)+ i18n 缺键 0/不对称 0 + build 绿。
- `npx react-doctor@latest -y`:100/100。
- 本轮零代码修复,无修复提交。

## 待办

- 真机目检(A~F 攒一次):设置七导航组折叠与深链自动展开、远程落地页三态(有 SSH 会话/WSL 工作区/纯本地)、WSL rail 取钉后 ⋯ 可达、恢复精简布局确认链、新建会话/工作区来源分组。
- 分支 ahead 11 未推送。
