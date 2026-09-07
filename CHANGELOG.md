# 更新日志

本文件记录 tmd-cli 每个版本的变更,格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
版本号与 Git tag(`vX.Y.Z`)及 [GitHub Releases](https://github.com/chenxiangning/tmd-cli/releases) 一一对应;
发版时在此追加小节,推送 tag 后 CI 自动构建并挂产物到 Release。

## [Unreleased]

### 新增

- cli-dsh PTY 适配器一期:会话内对话 / 审批提问卡 / 底栏 footer(host-RPC 第二客户端)
- Git 多仓支持:workspace 根多仓发现(git_repos_scan)与仓上下文切换(RepoBar / 引导 / 跨仓文件树着色)
- 侧栏运行区:运行中 / 结束未查看会话自动聚集且单区显示

### 修复

- 会话删除记 tombstone 全域隐藏且先杀后删;归档满额逐出 / 归档视图独立分页;dsh 走删盘删除通路
- dsh 适配器落盘迁入 ~/.tmd-cli/adapters/dsh:清场删除此前被 fs 白名单拒绝恒无效果
- proc_run 收割改杀整棵进程树:Windows .cmd shim 超时后孙进程握管道致线程挂起泄漏
- sqlite_query / sqlite_execute / fs_edit 命令族改 async + spawn_blocking:CLI 持写锁时不再冻 UI
- git shell-out 固定 LC_ALL=C:非英文 locale 下凭据失败不再误分类

### 重构

- 覆盖层满额逐出 / FilePatch 提取 / with_repo 缓存段 / 行标题兜底链 / 终端呼吸灯等六处重复收敛

## [0.1.2] - 2026-09-06

### 新增

- 会话管理模式与归档视图:工作区侧栏段头开关 / 拖选多选 / 批量归档删除 / 归档徽记
- 工作区归档容量护栏,避免无界膨胀
- 工作区拖选多选锚点改 key 免重排错选,武装态对齐 danger token
- 工作区标题加文件夹图标,与已置顶段头同基线对齐
- 文件树按 Git 变更着色并可在 subbar 一键开关(subbar 通用 actions 槽接入)
- Git 文件列表布局默认平铺,视图 / 布局切换落盘并重启恢复
- Git 分支视图下拉图标化,刷新下移聚合行,loading 兜底转满一圈,审批线换 SealCheck
- Git 拉取失败提示条支持 X 关闭
- 编辑 tab 条上移顶栏与会话 tab 合并一行,编辑栏去第二排;溢出走马灯滚动,会话 tab 前置引擎 logo
- 顶栏右区竖线对齐栏边界,Windows 控制带改绝对定位 overlay 治窄窗重叠
- 顶栏左区图标首尾对调,移除中区项目面包屑
- omp 安装更新前置 bun 门控,依赖就位前按钮禁用并引导先装 bun
- 网络代理侧栏图标换梯子造型

### 修复

- Windows 终端黑屏根修:ConPTY 启动 DSR 由本侧代答 CPR
- Windows 单测缺 v6 manifest 启动即崩,comctl32 延迟加载并平台化旧断言
- omp 子插件装卸 reject 兜底防永转,安装超时追杀整棵进程树
- omp 会话 slug 映射盘符冒号修身份绑定断链,config 解析容忍 CRLF
- 记忆 home 去 node 依赖与池状态二态判定,迁移窗口接线与面板入口兜底
- Tauri gen/schemas 生成物退出版本控制(构建本地再生成),权限真源在 capabilities/default.json

### 重构

- 图标库 lucide-react 全仓迁移 @phosphor-icons/react,依赖与锁文件同步退场
- 清理设计冗余


## [0.1.1] - 2026-09-06


### 新增

- 底栏版本号可点击:弹窗分页查看各版本更新记录,一键检查 GitHub 最新发布并前往下载
- 内置终端:头部左区一键新建本地默认 shell 会话,与 CLI 会话同一套终端体验
- 全局快捷键:设置新增「快捷键」清单,Ctrl+Tab 切换会话标签、⌘J 聚焦输入区、⌃⌘F 终端最大化等
- opencode CLI 引擎接入(第 9 个引擎)
- 记忆协调(Memory)插件:接入 Magic Context 共享记忆库,右栏 Memory 面板 + 状态栏 Memory 胶囊 + Memory 控制台(预蒸馏 / 记忆 / 设置),二期自动蒸馏为 opt-in
- Git:分支右键菜单全量(变基 / 合并 / 对比 / 重命名 / 检出远端分支),推送、拉取、获取改为对话框并带聚合统计,stash 智能还原,推送自动建立跟踪
- Git 差异视图:hunk 头渲染为细分隔条降噪,文件列表终端风显示每文件增删行数,文件行悬停一键打开文件
- 会话标签右键菜单:重命名、关闭其他 / 全部
- Checkpoints 批回退 / 应用改精准手术:只动本批改动块,共改文件不再误伤其他内容
- 会话启动失败弹 toast 明确提示,不再静默无感
- Composer 输入区可拖高至五段

### 修复

- npm 通道安装 CLI 失败(npm 12 默认禁用 postinstall,现自动放行)
- SSH 连接失败保留会话卡,可直接重试,不再原地消失
- Git 视图下拉菜单深色主题下文字不可读
- Git 提交成功缺少反馈,现给出可见提示(与错误同槽位,下次编辑即清)
- macOS 下 Ctrl+M/N/P/W 等按键不再被全局快捷键劫持,按原义传给终端
- 终端输出尾部的不完整字符(如半个汉字)不再丢失

## [0.1.0] - 2026-09-04

首个公开发布版本。

### 新增

- 插件化桌面客户端骨架:Tauri 2 + React 19 + TypeScript,内核注册表 + 插件 ctx 贡献面
- 8 个 CLI 引擎接入:omp / pi / claude / codex / grok / kimi / qoder / qoder-cn
- xterm.js 原生终端画布与 PTY 会话管理,会话标题 tab 切换
- Composer 富输入区:`/` `$` `@` 触发补全、命令抽屉、附件
- 右栏面板:Git 状态 / 历史图 / diff、checkpoints 批次审批、会话预算、网络代理
- 文件编辑器(CodeMirror 6)与多形态预览:markdown / pdf / docx / xlsx
- SSH 一等会话:远程终端 + SFTP 文件树 + 端口转发
- 插件市场、设置面板、网络代理

[0.1.2]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.1
