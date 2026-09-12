# 更新日志

本文件记录 tmd-cli 每个版本的变更,格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
版本号与 Git tag(`vX.Y.Z`)及 [GitHub Releases](https://github.com/chenxiangning/tmd-cli/releases) 一一对应;
发版时在此追加小节,推送 tag 后 CI 自动构建并挂产物到 Release。

## [0.1.6] - 2026-09-12

### 新增

- DSH 会话流式输出:适配器 follow 订阅开启 `assistantStream` opt-in,dsh 0.1.2 host 随轮次推送 `assistant-stream` 活帧(start/chunk/end)——正文与思考逐 delta 到达(投影层新增 assistant-stream 帧投影,轮次引擎 text-delta/reasoning-delta 走既有流式管线),durable assistant/message 沉降按 attempt 去重防双渲染;此前正文为整消息沉降(订阅未开 opt-in,旧注释误判「无流式 chunk 事件」,2026-09-12 真机抓帧纠正,codemoss 同款接法)
- WSL 支持(M1):WSL 卡(本机发行版枚举/设默认 + 经 SSH 连远程宿主,主机簿复用 ssh 配置)、添加工作区弹层发行版 tab(远程落库 `~` 形态 Linux 路径,本机落 UNC)、发行版内引擎探针(登录 shell PATH 含 ~/.local/bin;/mnt/* 互操作不计;未探测时新建会话菜单只留引导不显示不可用 CLI)、新建/恢复 WSL 会话(SSH 包装 `wsl.exe -d`,引擎档案随会话透传,点历史行 = 已知身份绑定:去重聚焦既有/磁盘行隐藏/真标题回填)、远程磁盘历史扫描与模型/思考观测(账号级额度照常回填)、远程文件树与 wslr:// 只读预览(超 512KB 显式降级);侧栏分组身份统一「profileId 或 engine」,引擎会话归 CLI 组
- 会话 tab 平铺显示:打开的 tab 全部并排同屏(≥2 个生效),点分栏即聚焦切换,开关全局持久;平铺态输入框出现「广播」开关,开启后输入喂给平铺全部幕布,关闭回落单发
- 界面缩放便捷组:侧栏左下工具条新增 − / 档位 / +(设置页同款 uiZoom),点档位数字重置 100%
- 首页标题条手动全量刷新:首页数据 SWR 缓存后回首页不再自动重拉,标题条刷新按钮一键强制重探全部引擎与前置依赖、绕过 5 分钟 TTL 与去重重拉最新版与凭据额度,探针进行中图标旋转;键盘提示行随 GitHub 链接靠右成组

### 变更

- 首页数据 SWR 缓存与 welcome 常驻层化:探针/最新版/凭据/token 用量落模块级缓存,回首页即时呈现 + 后台静默重验;welcome 与会话现场改 display 兄弟层互切,切换零回放零遮罩;宿主通知订阅收窄(首页三件套锚定注册集指纹、会话状态行 1Hz 按需重渲),会话切换的重渲染面积大幅收敛
- 插件市场改不透明覆盖层:打开时三栏保持挂载且留在下层,会话现场/文件 tab/分栏尺寸零回放零重排,关掉即回
- 回首页按钮改固定身份纯 toggle:永远显示「回到首页」,点一下开首页、再点切回打开首页之前的会话(该会话已退出则保持首页,不再回落其它 tab);市场覆盖层盖住首页时回首页先收市场,「点了没反应」根治
- 内核来源注册表化:workspaceOrigins / fileSources / ptyAdapters 三注册表承载来源插件(WSL)的全部贡献(侧栏过滤/徽章/新建会话适配、远程文件源、spawn 包装),workspace/files 去 WSL 硬编码;拔出插件重启即回内建形态(契约见 docs/architecture/09-wsl-contract.md)
- 会话状态 label 更名:「会话结束-未查看/已查看」→「空闲-未查看/空闲」——原词被误读为进程退出,实义是本轮对话结束、CLI 仍存活;状态机零改动(omp 18.1.17 整轮字节流回放实证诊断)
- 活动守望重构为证据分级模型:输出分片按「字母骨架 + 数字串」分为内容/活家具/死家具三级,静默判定只认内容与活家具(elapsed 计数)证据;新增无 spinner CLI 的 120s 思考期宽限 —— 根治六层特判闸互咬的历史(同日三修:空闲重绘闸 → P0 假结算 → 思考期守卫),真实 omp 18.1.17 整轮字节流回放验收,既有契约测试零改动全绿
- 内部治理:插件边界收敛与 99 处死导出清理(零逻辑改动)、远程磁盘标题索引合并单遍遍历、react-doctor 维持 100 分

### 修复

- 活动守望守卫死锁:回显窗内完结的轮次(/help、即时报错)遇 spinner 永续自绘会永挂运行时,守卫塌缩为单一「未应答写入天花板」(120s 内不结算未应答轮次,到期必结算),连带修掉单帧家具废掉空轮宽限的盲区;重绘抑制窗前置到分类之前(独立评审 F1/F4/F5)
- 悬停提示目标卸载或窗口失焦后清除残留气泡
- 后台会话等待确认经 headless 屏幕镜像补盲,webview 重载后读磁盘尾补底,关 tab 的会话不再收不到提问提示
- 设置持久化前拉盘合并记录层,双实例运行不再覆盖写丢归档置顶等标记

## [0.1.5] - 2026-09-11

### 新增

- 首页终端窗体重设计:无会话首页整页重构为终端窗体形态——prompt 行(工作区选择 + engines/updates 统计)+ 引擎全动作行(新会话/安装|更新|重装/重探/官方文档全动作内联)+ RESUME/QUOTA 页脚;键盘 ↑↓ 移游标、⏎ 直启新会话(原型 docs/design/home-redesign-s-full-actions.html)
- 首页 token 用量 dashboard:RESUME/QUOTA 之下新增「tokens — 用量」区,左列按引擎用量条(量值标柱尖)、右列近 7 日双段趋势柱(输出/输入+缓存),顶部统计条(今日/7 日/消耗会话/pi 系费用);数据纯本地,自各 CLI 会话 JSONL 提取(omp/pi 短名 + claude `_tokens` 后缀 + codex token_count 末次快照),零消耗引擎不显示
- composer 输入历史:Tab 接受 ghost 补全、空输入 ↑↓ 召回翻页、设置页管理区(可开关);IME 组词期补全自动禁用
- 设置:`pnpm doctor` 脚本接入 react-doctor 代码体检

### 修复

- installer 双副本遮蔽:npm install -g 命中的副本不在探针所见路径时(--prefix 遮蔽,hermes/nvm/官方安装器场景),按 node 全局布局加 --prefix 就地更新,「更新成功但版本不变」根治(本机 kimi/opencode 实证)
- dsh 适配 0.1.2+ 协议换代,打通凭据链与会话对话
- git 无 upstream 分支 ahead 降级统计唯一提交数,推送按钮恢复数字与计数标题
- 本机插件插排计数改为已装本地插件数,与页尾本地分区同源
- 插件强化:manifest 权限门面、贡献回滚栈与崩溃熔断;信任闸读回哈希闭环与激活失败状态机修正
- composer 输入历史自评审:ghost 长文本对齐与下拉并存两处 P2

### 变更

- react-doctor 全库治理 45→100 分:a11y(真实 button/listbox-option 语义)、组件复杂度拆件(composer 键盘分发/浮层、welcome 引擎行拆件)、300 行铁则回规;CI 接入 react-doctor 工作流
- pnpm 供应链硬化:新依赖须满 7 天观察期并禁非常规来源

## [0.1.4] - 2026-09-10

### 新增

- 本地插件系统:`~/.tmd-cli/plugins/` 目录放包即装,免重启装载,改盘自动重扫「对话即变」;SHA-256 内容信任闸(未信任先「待启用」确认)与 API 纪元闸双重门禁;设置页「本地插件」分区提供复制开发提示词 / 重新扫描 / 禁用全部,每个插件带权限清单、版本历史与一键回退;插排页本机插件独立成排,composer 抽屉与命令面板同步准入
- checkpoints 归因:工作区外文件写入事件入账,首轮无前像时禁用回退,防误删既有文件

### 修复

- 终端弃用 WebGL 渲染器改走 xterm 内建 DOM 渲染,根治 WKWebView 下 atlas 长跑静默损坏
- 终端启动相位输入闸挡掉 xterm 应答尾字节注入 PTY
- ask 等待提醒只按真作答上抑制闸,synthetic 回传不再清等待态
- 本地插件回退后 manifest 版本号对齐归档快照,版本历史按内容 hash 去重,不再显示「0.2.0-<0.1.0hash>」类错位条目

## [0.1.3] - 2026-09-09

### 新增

- 磁盘会话先行回放:点击磁盘历史即用上一代日志尾分块回放秒出画面(百毫秒级,零进程),resume 进程后台异步拉起;墓碑帧保持可见,CLI 首帧画完(清屏序列后 300ms)无缝切换,全程无白屏;首开无指针会话保持「正在连接」进度遮罩同样无缝切换;新增 `session_link_log` / `session_disk_tail` 原生命令与每 CLI 会话日志指针(纯通用原语,零引擎适配)
- 设置页新增 CLI 独立配置:四引擎本地配置图形化编辑,行级补丁写回零 Rust 改动;omp 配置项全量新手说明(解决什么/影响什么两段式),模型回退链改有序多候选两级选择器
- 快捷键录制改键,命令按钮带键位悬浮提示
- 工作区分组:侧栏分组渲染、设置页组管理、右键移动到组;工作区支持行内重命名别名,显示名全位覆盖
- 审批线面板新增会话时间线页签
- Git 文件 diff 单栏/双栏切换与全文查看
- 图标装饰设置:7 个界面图标独立颜色与呼吸闪烁
- 会话标题 tab 条容量可配置(1-10),关闭时隐藏容量滑杆
- 智能体与提示词资产库:composer「!!」/「##」双触发候选,设置内双 tab 资产管理
- 会话列表扁平化:分组段头与折叠退役,会话行平铺工作区下,行首供应商图标与树形参考线
- 幕布加载进度条:大缓冲分块回放与冷启流式字节计数,全程真实进度

### 修复

- 会话 tab 保活挂载,切换零重放不再重现 loading 遮罩;幕布遮罩就绪后加锁,实时字节与回放回调不再回弹卡死
- 会话标题以首条用户消息即时保底,AI 命名迟到改退避补扫,tab 标题跟随磁盘真标题
- webview 重载后从磁盘日志尾恢复 Ask 等待状态,关 tab 的后台会话不再收不到提问提示
- composer 触发符前置为词字符时不再误弹候选;ask 作答与轮中控制命令不再起审批线锚点
- 审批线查询改按会话 cwd 取账本,修复选中他工作区会话时谎报非 git 空态
- 退出应用杀全部 PTY 子进程防孤儿常驻;应用内重启改走 request_restart,退出杀 PTY 不再被绕过
- 工作区:管理行键盘可达、嵌套按钮不再截胡按键,已删会话隐出运行区且磁盘行删除先杀绑定活会话,归档定位找不到行时给提示,定位请求改 FIFO 队列,磁盘会话打开失败不再静默
- 资产库:提示词重名拒绝、写盘失败上浮 UI,会话消亡剪除选中表死 id,智能体徽章非 emoji 图标回退 Robot,补 en/ja 词典
- CLI 应答宽限收窄到命中分支,EOF/断连立即收割
- 会话 tab 右键重命名仅磁盘会话可用,活会话不再留死链
- markdown 链接分流补 protocol-relative 与大写 scheme
- 记忆面板日期随界面语言切换
- kimi / codex 市场图标恢复 glyph,图标色对齐主题前景变量
- 关 tab 的已了结 CLI 会话加轮次开启闸,异步噪音不再误标未读

### 重构

- 六处注册表并入 createSubscribable,归档/删除覆盖层并工厂;codex 快照降级与 snapshot 塑形收口 cli-shared;mermaid/image 全屏查看器合一;qoder 双分发版收口 makeQoderPlugin 工厂

### 清理

- 移除 cli 副车诊断落盘临时管线,保留缺失警告
- 删除 ssh_sftp_stat / ssh_sftp_transfer_status / ssh_session_status / git_fetch 四个零调用 IPC 命令整链
- release 构建体积优先:opt-level=z,icon.icns 去 1024px,logo 缩 128px

### 移除

- 启动自动激活:预开真实进程换点击秒开的代价为结构性常驻内存(实测整树 6.7GB/3h);其存在理由已被磁盘先行回放整条拆除,设置项与后台预开链路全部移除,退出清场(`kill_all`)保留

## [0.1.2] - 2026-09-08

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
- cli-dsh PTY 适配器一期:会话内对话 / 审批提问卡 / 底栏 footer(host-RPC 第二客户端)
- Git 多仓支持:workspace 根多仓发现(git_repos_scan)与仓上下文切换(RepoBar / 引导 / 跨仓文件树着色)
- 侧栏运行区:运行中 / 结束未查看会话自动聚集且单区显示
- 浅色主题扩至 19 套,并按各主题官方色相重派生终端 ANSI 16 色
- composer 消息锚点栏改贴顶紧凑排列
- 自定义主题的浅色/深色分组支持折叠
- 引擎品牌色烘焙进 glyph,单色品牌统一随主题取前景色(qoder 深浅主题对比度一并修复)
- 顶栏会话 tab 行内加「置顶扎点」与「定位」两枚 icon:扎点与侧栏同语义置顶到全局/取消;定位一键展开左栏并滚动高亮该会话在侧栏的位置(遵循单一区域原则:全局置顶→已置顶区、运行区候选→运行区、其余→工作区分组)

### 修复

- Windows 终端黑屏根修:ConPTY 启动 DSR 由本侧代答 CPR
- Windows 单测缺 v6 manifest 启动即崩,comctl32 延迟加载并平台化旧断言
- omp 子插件装卸 reject 兜底防永转,安装超时追杀整棵进程树
- omp 会话 slug 映射盘符冒号修身份绑定断链,config 解析容忍 CRLF
- 记忆 home 去 node 依赖与池状态二态判定,迁移窗口接线与面板入口兜底
- Tauri gen/schemas 生成物退出版本控制(构建本地再生成),权限真源在 capabilities/default.json
- 会话删除记 tombstone 全域隐藏且先杀后删;归档满额逐出 / 归档视图独立分页;dsh 走删盘删除通路
- dsh 适配器落盘迁入 ~/.tmd-cli/adapters/dsh:清场删除此前被 fs 白名单拒绝恒无效果
- proc_run 收割改杀整棵进程树:Windows .cmd shim 超时后孙进程握管道致线程挂起泄漏
- sqlite_query / sqlite_execute / fs_edit 命令族改 async + spawn_blocking:CLI 持写锁时不再冻 UI
- git shell-out 固定 LC_ALL=C:非英文 locale 下凭据失败不再误分类
- cli RPC 副车应答尾部被提前收割斩断,致命令发现回退静态表

### 重构

- 图标库 lucide-react 全仓迁移 @phosphor-icons/react,依赖与锁文件同步退场
- 清理设计冗余
- 覆盖层满额逐出 / FilePatch 提取 / with_repo 缓存段 / 行标题兜底链 / 终端呼吸灯等六处重复收敛


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

[0.1.6]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.6
[0.1.5]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.5
[0.1.4]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.4
[0.1.3]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.3
[0.1.2]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.1
