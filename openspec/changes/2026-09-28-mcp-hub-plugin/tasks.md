# MCP Hub 任务分解

> 纪律:先契约测试后实现;每任务组完成即过对应门禁;与 skill-hub 插件并行执行,冲突面守 proposal §6;提交用显式文件清单。

## 1. 写引擎与声明(P3)

- [x] 1.1 `src/plugins/cli-shared/mcpWrite.ts`:JSON upsert/remove(未知键保留、解析失败拒写)+ TOML 行级段 upsert/remove(注释保留、尾追加、env 内联表、引号转义);头注释声明与 mcpFormat.ts 同一格式域先例;单测矩阵
- [x] 1.2 写适配器声明进 CliProfile(复用 `listMcpServers` 既有声明机制,执行时以 CliProfile 现状为准):六家(omp/kimi/qoder/codex/grok/claude)各声明自家读写适配器,写实现调 mcpWrite;逐家核对磁盘实证(上游调研 §3.2 矩阵),出入以磁盘为准;pi 显式「—(靠扩展)」;文件缺失语义(JSON 家 = 首存即建,TOML 家 = 隐藏)

## 2. 管理面(P3)

- [x] 2.1 插件壳:`index.tsx` 注册面(filePanel + tabContent + allPlugins 一行)、`hubTab.ts`、`McpHubPanel.tsx` 右栏概览;桩目检:图标/计数/开 tab
- [x] 2.2 `ServersView.tsx` + `RawFilePreview.tsx`:引擎栏 + server 卡片列表 + 原始文件预览
- [x] 2.3 `ServerEditModal.tsx`:ServerDraft 字段集(transport 三选互斥/stdio 组/remote 组/id 唯一校验)、env/headers 值列掩码(聚焦显明文)、保存写回(`.bak-tmd` 备份 → upsert → 写回;失败回滚)、改名 = 删旧增新、写后提示「下次会话生效」不承诺时点
- [x] 2.4 写回安全实证测试:保存前后 diff,非目标内容零变化(TOML 注释逐行保留;JSON 未知键保留);`.bak-tmd` 落盘与恢复断言;掩码断言

## 3. 商店(P4)

- [x] 3.1 `registrySources.ts` + `registryNormalize.ts`:三源 client + McpRegistryCard 归一 + installDraft/manualDraft 生成 + {VAR} 模板系统(占位扫描 → ConfigInput → 填值替换);单测(quota_fetch 桩:三源归一/模板/单源失败空态)
- [x] 3.2 `StoreView.tsx` + `StoreCard.tsx`:源切换/搜索/卡片/内存缓存 + 刷新
- [x] 3.3 `InstallDraftModal.tsx`:模板填空表单 + 目标引擎选择 + 落位预览(将写入的 server 形状)→ mcpWrite 写回(同 `.bak-tmd` 纪律)

## 4. 导入桥(P5)

- [x] 4.1 `importScan.ts`:扫描集(~/.claude.json 顶层 / ~/.mcp.json / ~/.codex/config.toml / Claude Desktop / ~/.codebuddy/mcp.json / 手选文件)+ transport 推断(显式 type 优先,command→stdio / url→http);单测(路径桩/推断/同名首源优先)
- [x] 4.2 `ImportView.tsx`:来源分组勾选、冲突标记(已存在同 id 默认跳过可勾覆盖)、导入写回(`.bak-tmd`)

## 5. 连通测试(P5)

- [x] 5.1 `src-tauri/src/mcp_probe.rs`:spawn → initialize(版本自新向旧候选)→ tools/list → kill,15s 超时,错误附 stderr 尾 5 行;cargo test + clippy + fmt;接线 lib.rs +1 行、ipc.ts +1 方法(守并行纪律)
- [x] 5.2 `probe.ts`:stdio → mcpProbe;http/sse → quotaFetch 握手;server 卡片测试按钮 + 行内结果徽标(工具数/延迟/错误)

## 6. 收口

- [x] 6.1 全门禁:typecheck / test(3176+ 全绿)/ arch-boundary / file-size / build / cargo 三连(324 passed + clippy -D warnings + fmt)全过;react-doctor 100 留主 agent 合并收口(共用工作树 skill-hub 并行在途)
- [ ] 6.2 真机 `pnpm tauri:dev`:omp mcp.json 增 server → omp 会话 `/mcp` 面板可见(端到端);codex config.toml 写回 git diff 仅目标段变化;输出操作记录供大仙复验
- [x] 6.3 提案状态回写(proposal 头部)+ docs/README.md 索引行核对
