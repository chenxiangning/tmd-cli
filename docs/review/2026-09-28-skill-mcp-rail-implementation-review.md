# 技能/MCP 唤醒双图标实施批次评审(2026-09-28)

> 对象:spec v2(`superpowers/specs/2026-09-28-composer-skill-mcp-rail-design.md`)的两批实施。
> 纪律:每批次完毕换角度独立评审一轮再开下一批。批次 A = 引擎发现层,批次 B = 交互面。

## 批次 A(MCP 发现层:cli-shared/mcpFormat + omp/kimi/grok/qoder 适配器 + codex 重构)

评审 = **OK(0×P0/0×P1/5×P2)**,当场处置:
- P2-1 i18n 缓存滞后:description 改存中文源串,渲染期 `DrawerItemList t()` 接管(同根因的 claude/codex 拼串一并修);kernel locales cli 域补整串键(en/ja)。
- P2-2 扫描面裁剪:omp 项目根独立 mcp.json 层与 grok 逐级向上层属 spec 有意裁剪,两适配器头注记明,免得复查。
- P2-3 env 覆盖(KIMI_CODE_HOME/omp agentDir):tmd spawn 不设这些 env,暂不处理,注记。
- P2-4 字序:spec/评审记录统一为「仅展示 · 无引用语法」。
- P2-5 TOML 段头正则放宽:容忍段名前后空格与行尾注释,补回归用例。

## 批次 B(交互面:drawerOpen 状态机 + drawerLanding 裁决 + RailWakeIcons + MagicWand 换形)

评审 = **BLOCK(1×P1 + 3×P2)**,全部当场修:
- **P1-1 未解析窗口点图标被吞**:抽屉已开、动态未达(慢引擎 RPC 冷启动 5-6s)时点图标,裁决返回 null,`applyDrawerSection(next ?? tab)` 把待决意图抹回 tab → 终拍永不落该区,连点同图标的「同区关」判定同时失效。修法:守卫抽成纯函数 `shouldMirrorDrawerIntent`(next=null 且 want≠tab = 不回写,意图留存到终拍),配回归用例。
- P2-1 `toggleDrawerSection` 开帧复位 resolved 分支补 `getDrawerResolved()` 断言。
- P2-2 CommandDrawer 头注释「打开时重置为全部」更新为落位新语义。
- P2-3 删 `t("MCP 服务器") as string` 冗余断言。
- 评审确认过的关键点:fresh 分支不看 resolved 安全(开帧路径 emit 前同步复位);镜像环无死循环(同值不 emit);StrictMode/HMR 双跑幂等;MagicWandIcon 为 phosphor 实名(MagicWand 是 deprecated 别名);⌘K/Esc/×/工具条/320ms 关闭复查全回归过。

## 验证收口

- 门禁:387 测试文件/3102 用例全绿、typecheck(本任务域)绿、arch-boundary 绿、file-size 绿、build 绿、react-doctor 100/100。
- 1421 桩目检(Tauri 桩 + 真实 store 驱动):轨上 6 图标、点技能直达技能区(`$brainstorming` 上屏、active 描边)、已开换区 MCP(`zread · MCP · 全局 · ⚡发送`)、同区点关、dsh 会话双图标隐藏、⌘K 回落「全部」(stale 防护);P1 修复后全路径复验通过。
- 真机 `tauri:dev` 目检待大仙(spec 验证 7)。

## 真机反馈返工(同日,大仙目检两问题)

1. **双图标「不是显示和关闭」**:根因 = 未解析窗口(慢引擎技能扫描/omp RPC 冷启动 5-6s)内点图标,裁决挂起不落位 —— 点击无可见反馈,二击反变关闭。返工裁决:`nextDrawerTab` 改**立即落位**(rule2:有意图未落 → 立即切该分区,空区先显「暂无」也是可见响应),终拍空区回落「全部」校正;镜像守卫 `shouldMirrorDrawerIntent` 随之删除(pending-null 状态不复存在,落位即镜像)。此即 spec 原文「开帧先落意图分区,终拍无条目回落」的本义,实现曾偏离、现归正。
2. **意图画布图标无边框**:`ComposerDrawToggle` 关态 `border-transparent` → 对齐 rail 惯例(`--tmd-border` 边框 + elevated 底 + faint 前景,hover accent)。

桩复验(慢扫 6s 窗口模拟):点技能 → 立即落技能区+active;同区再点 → 关;再点 → 重开落位;终拍条目到达正常渲染;作画按钮 border 1px 实测生效。门禁复跑全绿(387 文件/3101 用例、react-doctor 100、build 绿)。

## 真机反馈追加(同日,提示 toast 一致性)

大仙目检:广播点击有上方滑出提示,意图画布与提示词增强没有。调整:
- `.composer-broadcast-toast` 泛化为 `.composer-rail-toast`(广播/作画/增强三钮共用,广播原行为不变);
- 作画开关:开 → 「作画已开启:下一条发送将附带作画指令」、关 → 「作画已关闭」(intent-canvas 域词典 en/ja 补键);
- 提示词增强:空草稿点击原为静默无响应 → toast「草稿为空:先输入内容再增强」;草稿非空仍直接开对照对话框(对话框本身即反馈,不叠加 toast)。
