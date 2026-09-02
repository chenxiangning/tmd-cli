# git-panel Specification

## ADDED Requirements

### Requirement: 仓库检测
系统 SHALL 在面板打开时检测活跃 session 的 cwd 是否为 git 仓库(`Repository::discover` 向上查找);非仓库 SHALL 返回 `E_NOT_A_REPO:` 前缀错误,前端 SHALL 渲染空态而非报错 toast。

#### Scenario: 非 git 目录
- **WHEN** 活跃 session cwd 不在任何 git 仓库内
- **THEN** 面板显示「当前目录不是 Git 仓库」空态,无错误 toast

#### Scenario: 子目录 session
- **WHEN** cwd 是某仓库的子目录
- **THEN** 面板正常工作,路径显示相对 repo root

### Requirement: 工作区状态
系统 SHALL 提供 `git_status(cwd)` 返回分支名、HEAD sha、变更文件清单(path / status / staged);detached HEAD SHALL 显示 `detached@<短sha>` 且不 panic。

#### Scenario: 变更折叠
- **WHEN** 文件同时 staged 且工作区再被修改
- **THEN** 该行 status 显示 `M` 且 staged=true

### Requirement: 文件差异
系统 SHALL 提供单文件 unified patch(`git_diff_file_patch`),含 additions/deletions 计数与 binary 标记;renamed 文件 SHALL 携带 oldPath。

#### Scenario: 二进制文件
- **WHEN** 用户点开二进制文件
- **THEN** 抽屉显示「二进制文件」而非乱码

### Requirement: 索引操作原子性
stage/unstage/discard SHALL 经 `fresh_index`(`index.read(true)`)读取最新磁盘 index 后操作,单次调用内多文件原子落盘。

#### Scenario: 外部并发 add
- **WHEN** 用户在幕布终端执行 `git add` 后 1s 内,面板执行 stage
- **THEN** 面板操作基于最新 index,不丢外部暂存

#### Scenario: discard 保护
- **WHEN** 用户对路径列表执行 discard
- **THEN** 仅还原已跟踪文件,untracked 文件 SHALL 保持不变

### Requirement: 勾选提交
`git_commit(cwd, paths, input)` SHALL 在 paths 非空时先 stage 所选文件再创建 commit,两步同进程顺序执行;空 message 或无变更 SHALL 返回 `E_EMPTY:`。

#### Scenario: 一步提交
- **WHEN** 用户勾选 3 个未暂存文件、输入消息、点提交
- **THEN** 单次 IPC 完成 stage+commit,新 commit 含且仅含 3 文件

### Requirement: 分支操作
系统 SHALL 提供本地/远程分支列表(按最近提交时间排序)、checkout(safe,脏工作区冲突由前端 confirm 前置)、创建、删除;checkout 当前分支 SHALL 幂等拒绝。

### Requirement: 历史摘要
系统 SHALL 提供 `git_log(cwd, limit, offset)` 分页返回提交摘要(短 sha / 首行 / 作者 / unix 时间 / parents)。

### Requirement: 远端操作凭据安全
fetch/pull/push SHALL shell-out 且设置 `GIT_TERMINAL_PROMPT=0` 与 `GIT_SSH_COMMAND=ssh -o BatchMode=yes`;凭据失败 SHALL 返回 `E_AUTH:` 前缀,前端 SHALL 引导用户去幕布终端完成交互。

#### Scenario: SSH passphrase
- **WHEN** 用户 SSH key 有 passphrase 且点 push
- **THEN** 命令快速失败(不挂死),toast 提示去终端执行

### Requirement: 提交执行权
commit 的唯一触发入口 SHALL 是面板「✓ 提交」按钮;composer 插件经事件总线预填消息,SHALL NOT 直接向 PTY 反射任何 git 指令文本。

### Requirement: 刷新策略
status SHALL 5s 轮询,窗口失焦时暂停;写操作完成后前端 SHALL 立即 refresh;ahead/behind SHALL 不随 status 轮询,仅在 fetch 完成 / 分支切换 / 手动刷新后获取。

### Requirement: 布局契约
面板 SHALL 为单视图纵向三段:工具栏(视图下拉 + 刷新 + ahead 计数 + 平铺/树形 + 分支)、文件列表(checkbox + 状态字符 + 类型图标)、常驻提交 composer;视图下拉 SHALL 含「差异 Diff / 分支 / 历史」三项与 disabled 的「Git Graph」占位。
