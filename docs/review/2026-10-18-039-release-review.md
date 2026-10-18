# 0.3.9 发版终审(release review)

日期:2026-10-18 · 对象:`v0.3.8..d20dba3a`(21 commits,发布 tag 另含 CHANGELOG-only 收口 commit)· 结论:**放行发版**

## 结论

OK with notes。代码面零改动放行;唯一阻断为 CHANGELOG worktree 条目入口表述失实(纯文档),已改。终审由独立 reviewer 完成(方法:reflog 逐笔核 21 commits + HEAD 终态代码 + 契约 26 + 前两轮评审记录交叉,三轮修复逐项代码抽查)。

## 六项重点核验(全过)

1. PTY 幕布红线:过——`pty://out` 消费面无新增;批注气泡在 git diff 视图,回传经 composer 插入桥不自动发送;bench.html 独立工具页 src 零引用。
2. 架构边界:过——@tauri-apps 仅 ipc/transport;plugins 无 @shell 反向;新增 kernel 面 lazyTab/frontmatter 为通用原语;Rust `git_ensure_local_exclude`/`git_worktree_disk_usage` 通用;git⇄workspace 走纯模块+豁免注释(契约 26 首例声明一致)。
3. 三轮修复真修净零复员:toggleSent/批注逐条归属/wiki 幂等键与读失败防清库/quota 分块+尾读并发闸+未来行剔除/懒加载终败不毒化熔断/worktree 移除闸终态(按活会话 cwd,两向测试)/junction raw_arg/IME 守卫 5 处。
4. CI 链不被击穿:gate 含 kernel-audit,ci.yml 四检查步同序;终审前三笔触达文件行数全 ≤300。
5. i18n 成对:新键 en/ja 均在,check:i18n-keys 在链。
6. 正确性:未发现新增数据丢失/崩溃/竞态路径。

## 发版前实测(集成人补跑,reviewer 建议 3)

- `pnpm check:gate` @ d20dba3a 树:全链绿(i18n 0 缺 0 不对称,521 files / 4071 tests,build ✓)
- `cargo test` @ d20dba3a 树(共享 target):356 passed 0 failed
- `cargo clippy --all-targets -- -D warnings` + `cargo fmt --check` @ 同树:净
- `npx react-doctor -y` @ 同树:100/100
- 懒加载 chunk 抽查:dist/assets 290 个 js,anim/memory/wiki 独立 chunk 在(建议 4 第二项)

## CHANGELOG [0.3.9] 一致性对账(21 commits 全对)

七特性 + anim 两条 + mobile 两条 + junction/frontmatter/移除闸 + 内务三条逐条与码符一致;5 笔未单列提交(docs/纯测试/周期内折入特性条)符合 0.3.8 先例。

## 阻断与修复

- 【阻断】worktree 条目两处「会话卡右键」表述失实(67ca88c7 已移除该入口,entryContract.test.tsx:87 钉死 not.toContain)→ 改为「工作区右键菜单唯一入口」并补「新建成功即加入侧栏工作区」;发布树与 main 双侧同步(d0d0bf06)。
- 【建议】小节日期改发版日 2026-10-18;architecture/26 同源措辞更新;frontmatter.ts:21 注释 typo。

## 遗留(不阻断,挂账)

- Windows 实机 junction 复验(fs.rs:142-152 为文档推导修复,本机无 Windows):沿列 docs/brainstorm/2026-10-17-039-next-steps.md 验收债。
