# Skill Hub 任务分解

> 纪律:先契约测试后实现;每任务组完成即过对应门禁;与 mcp-hub 插件并行执行,冲突面守 proposal §6;提交用显式文件清单。

## 1. 契约与骨架(P1)

- [x] 1.1 `skillScan.ts`:聚合十家来源(复用 `cli-shared/skillDirs.ts` 既有 `scanSkillDirs` 形态与 frontmatter 解析,grok 走既有 inspect 通道;补齐 opencode/dsh/pi 未接家;公约位 `~/.agents/skills` 单列组);`skillStore.ts` 缓存订阅;单测(fs 桩:多引擎/缺目录/公约位/来源徽标)
- [x] 1.2 插件壳:`index.tsx` 注册面(filePanel + tabContent + allPlugins 一行)、`hubTab.ts` openTab、`SkillHubPanel.tsx` 右栏概览;桩目检:右栏图标 + 概览计数 + 按钮开 tab

## 2. 已装视图(P1)

- [x] 2.1 `InstalledView.tsx` + `SkillCard.tsx`:按引擎分组、来源徽标(用户级/公约位共享)、名称/描述、模糊搜索
- [x] 2.2 `SkillPreviewDrawer.tsx`:元数据文件懒读,200KB 上限截断标记
- [x] 2.3 删除链路:确认弹窗(公约位删除提示影响面)→ trash 原子命令 → 缓存失效刷新
- [x] 2.4 `locales/en.ts` + `ja.ts`;桩目检全路径(分组/徽标/搜索/预览/删除确认)

## 3. Rust 原语(P2)

- [x] 3.1 `src-tauri/src/skill_pkg.rs`:`net_download`(60s 超时/重定向)+ `skill_extract`(zip-slip/symlink/10MB 三安全闸 + strip_top);cargo test + clippy + fmt;Cargo.toml 加 zip(最小 feature)
- [x] 3.2 接线:`lib.rs` generate_handler +3 行(net_download/skill_extract/skill_symlink,补链为 §4.6 claude symlink 选项所需)、`src/kernel/ipc.ts` +3 方法(插 fs 族封装后,守并行纪律)

## 4. 商店(P2)

- [x] 4.1 `clawhub.ts` + `clawhubNormalize.ts`:四端点 client、Card 归一化、owner 消歧(updatedAt → version → downloads 收敛;歧义报错列候选);单测(quota_fetch 桩:列表/搜索/409 消歧/网络错误)
- [x] 4.2 `StoreView.tsx` + `StoreCard.tsx`:排序词表、分类、260ms 搜索防抖、cursor 分页、已装徽标
- [x] 4.3 `InstallDialog.tsx` + `install.ts`:落位三选(目标引擎多选默认 claude / `~/.agents/skills` 公约位 / claude symlink 勾选,失败降级提示)、冲突裁决(覆盖=trash 旧/跳过)、阶段态(下载中→解压中→完成/失败逐目标)、缓存清理、生效提示不带承诺
- [x] 4.4 桩目检:商店列表/搜索/安装弹窗三选落位/网络失败态(错误页 + 重试,不白屏)

## 5. 收口

- [x] 5.1 全门禁:typecheck / test / arch-boundary / file-size / build / cargo 三连 / react-doctor 100
- [ ] 5.2 真机 `pnpm tauri:dev` 目检:ClawHub 真实浏览 + 公约位安装一发(`~/.agents/skills/<name>` 落位 + omp 会话 `/skill:<name>` 唤起取证);输出操作记录供大仙复验
- [x] 5.3 提案状态回写(proposal 头部)+ docs/README.md 索引行核对
