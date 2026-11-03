# 0.4.8 第二轮代码评审

> 日期:2026-11-03 · 状态:已收口(确认 4 项边界缺陷并当轮修复)
> 范围:当前 0.4.8 未提交 diff;从性能、兼容性、稳定性、正确性复核重试、结构化存证、WSL 编辑、worktree 交付与退出保护链。

## 1. 确认问题与修复

- **正确性:重试切换来源后可能展示并回填旧回合。** `RetryDialog` 在新来源读取开始时就清空 turns 与 selectedId,失败态不再沿用上一来源预览;请求代次闸继续阻止旧异步响应覆盖新源。
- **稳定性:resume 可能把旧进程排队任务锚到新 RPC 会话。** `StructuredTurnEvidence.reset()` 清除 activeSessionId、未发队列和工具暂存;`ssSession.retry()` 在旧进程 kill 后、重启前调用,已落账 Promise 链继续按序结算。
- **正确性:上一轮迟到工具完成帧可能补记到下一轮。** `settled()` 同步清理未结束工具,随后才 seal;无工具名参数的迟到 end 不再凭旧 start 找到路径。
- **兼容性:WSL 空正文保存不创建临时文件。** 空字节切块由空数组改成一个空 base64 块,确保执行 `.wtmp` 截断创建;既有分块、写前版本复核与原子替换不变。回归测试同时钉住空块与写脚本形态。

## 2. 四维结论

- **性能:** 未发现新增长驻轮询、无界队列或逐帧全量重算。结构化 token 帧继续 120ms 合帧;存证 anchor/edit/seal 串行化以落账正确性换取同轮写顺序;WSL 仍按 6KB 解码块写、512KB 总量闸与 60s 超时;React Doctor 100/100。
- **兼容性:** `RemoteFileSource` 字符串读返回与 `expected=undefined` 的旧来源保持兼容;重试确认仍只回填、不自动发送;worktree 沿用现有 diff、分支比较和 PR 对话,不新增 Git 服务依赖。
- **稳定性:** 重试来源代次、非激活 composer 接管、退出协调与定时器清理经复核未见新增失控路径;本轮补齐 resume 与 settled 的状态清空边界。
- **正确性:** checkpoint 按原轮号与全文双闸配对;干净 worktree 按 baseBranch 计算双向提交,不猜远端 PR 状态;WSL 保存前后以 mtime+长度令牌拒外改,空文件读写闭环已补齐。

## 3. 验证

- 聚焦回归:前端 6 文件 / 33 例;WSL 9 例通过,4 个真机凭据测试忽略。
- `pnpm check:gate`:609 文件 / 4741 例,typecheck、架构边界、i18n、kernel 盘点、文件规模与 build 全通过。
- Rust:401 例通过、5 个真机凭据测试忽略;clippy `--all-targets -- -D warnings` 与 `cargo fmt --check` 通过。
- `npx react-doctor@latest -y`:100/100。
- `git diff --check`:无空白错误。未修改版本文件,未提交、未发版。

## 4. 真机边界与未证实风险

- Windows WSL 空文件保存、外部改盘冲突、目录创建仍需 Windows 真机逐项验收;Rust 真机凭据测试没有在本机伪造通过。
- `ssSession.send()` 在 RPC response 成功后打锚;若某引擎先产生工具帧或 settled、后回 response,存证时序可能缺帧。目前没有真机证据证明引擎采用此顺序,不在本轮无证据改写事件缓冲协议。
- `ssActions` 批次查找沿用 prompt/prefix 证据;连续重复同文 prompt 的对应关系未由真机转录证明,暂不宣称已解决。
- 原生进程已启动烟测,但本轮没有把截图、逐项点击或 Windows 交互标成已验;这些保留给用户交付验收。

## 5. 发版终审补充

- **structured 历史深链:** 原 tab 存活时直接激活;原 tab 关闭后改开原 CLI 会话的只读磁盘转录并定位原文;查看器不可用返回 miss,不再新起空 RPC 会话假报成功。新增三态回归测试。
- **detached worktree 比较:** 当前侧分支名统一由 `worktreeCompareName` 决定,detached 使用 `HEAD`;PR 表单仍保留原空分支和禁止创建保护。新增普通分支与 detached 回归测试。
- **首页探针与依赖修复:** 已核对 omp 安装版本回读、统一 PATH 与 Bun 过旧一键修复链;一键修复只在用户点击后升级 Bun,不引入后台自动升级。
- **最终门禁:** `pnpm check:gate` 612 文件 / 4752 例,typecheck、架构边界、i18n、kernel 盘点、文件规模与 build 全通过;Rust 408 例通过、5 个真机凭据测试忽略,clippy 与 fmt 通过;React Doctor 100/100;`git diff --check` 通过。
- **原生烟测:** `pnpm tauri:dev` 进程启动后保持运行 40 秒并由脚本停止进程组;未将截图、逐项点击或 Windows 真机交互标为已验。

## 6. 首轮云端构建失败修复

- run `41614392641` 的 Android 与 iOS 成功,macOS arm64/x86_64、Windows、Linux 均在 Tauri 前置版本检查失败;Release 保持草稿,未对外发布。
- 共同根因是 Rust 锁文件已升级 `tauri-plugin-notification` 2.8.0 / `tauri-plugin-shell` 2.6.0,前端锁文件仍为 2.7.0 / 2.5.0。对齐两组 NPM 依赖与 `pnpm-lock.yaml`,不使用 `--ignore-version-mismatches` 绕过检查。
- `pnpm tauri build --debug --no-bundle` 已通过 Tauri 版本一致性检查、前端生产构建和 Rust 应用构建,确认原失败点消除。
