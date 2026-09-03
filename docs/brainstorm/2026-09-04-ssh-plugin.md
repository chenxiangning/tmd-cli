# SSH 插件需求澄清(参照参考实现)

日期:2026-09-04
状态:已收敛,进入 spec

## 背景

用户要求参照竞品 参考实现(本地优先 AI Agent 桌面,Tauri 2 + russh 0.62.2 + russh-sftp 2.3)在其 SSH 模块的基础上,为 tmd-cli 重构一个 SSH 插件,能复刻的代码与逻辑直接复刻。竞品调研结论见 `docs/research/ssh-module-reference.md`(调研问答落盘于本次会话,结论已并入本记录与 spec)。

## 竞品 SSH 模块事实(调研摘要)

- 三层:Rust 引擎(russh:连接/认证/KBI/known_hosts/重连/SFTP/端口转发/代理)+ 共享 UI(主机管理/隧道面板/SFTP 浏览器)+ Go 网关中继(权限门)。
- 认证矩阵:password / privateKey(PEM 清洗、路径展开)/ keyboard-interactive 多轮(上限 5 轮,回落密码)。
- host key:SQLite known_hosts(host+port 键,SHA256 指纹),首次信任 prompt 120s 超时。
- 代理:手写 HTTP CONNECT 与 SOCKS5 握手;系统代理可复用。
- 重连:3 次退避(2/5/10s),keepalive 30s×3,连接 id 代际(SFTP 通道随代际失效重建)。
- SFTP:与终端同连接开 subsystem(不重认证),list/stat/读写文本(乐观并发 mtime+size 冲突检测)/mkdir/rename/递归 delete/递归传输(64KB 缓冲,进度事件,可取消)。
- 端口转发:`-L`,127.0.0.1 绑定,端口 0 自动分配,占用预检,生命周期随会话级联。
- 短板:凭据明文 SQLite、无 ssh-agent/jump host/压缩/-R/-D。

## 用户决策(2026-09-04 问答复核)

| 决策点 | 结论 |
|---|---|
| v1 功能面 | 全量:终端 + 主机管理 + SFTP + 本地端口转发 + 代理 |
| 会话集成 | 一等会话:中央幕布 + 顶栏 tab + 会话列表,复用输出缓冲/翻页/搜索;composer 对 SSH 隐藏 |
| SFTP 形态 | 右栏树 + 中央编辑器 tab 读写远程文件(CodeMirror) |
| 凭据存储 | settings.json 明文(跟随 tmd-cli 现状惯例,spec 记录风险) |
| 认证矩阵 | 全量复刻:password + privateKey(含 passphrase)+ KBI 多轮 + known_hosts 信任流 |

用户指令:实施开始后不再提问,剩余技术细节由实现侧裁决(裁决记录进 spec 方案取舍)。

## 实现侧裁决(不再回问)

- russh 版本 pin 0.62.2 + russh-sftp 2.3(竞品实测组合,兼容本仓 rust-version 1.80;0.63 MSRV 1.85 超限)。
- 断线重连:Rust 侧有界自动重连(同会话 id,透明续流;超限后会话退出),不复活已退出会话。
- 会话进入入口:新建会话菜单新增「SSH 连接」入口(内核新挂载点)+ SSH 主机选择 overlay。
- SSH 会话不参与 Ask 检测/审批线/状态栏(无 CLI profile,kind 门控);呼吸灯照常(远端输出即活动)。
