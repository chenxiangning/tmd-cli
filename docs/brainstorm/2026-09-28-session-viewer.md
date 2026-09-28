# 会话查看器插件 brainstorm(2026-09-28)

- 日期:2026-09-28
- 状态:已收敛,spec 见 `docs/superpowers/specs/2026-09-28-session-viewer-design.md`

## 需求澄清对话

1. **大仙**:想单独做一个会话解析插件。入口绑定在会话列表里,每一个会话最右边加个 view icon 点击进入。单独解决,会话不走 PTY,也不改变正常 PTY 交互,可行吗?
   **回复**:完全可行。磁盘历史行本无 PTY,读 JSONL 走各 cli-* 已声明的只读适配器;展示面用 kernel registerTabContent 开中央 tab;真正工作量在「完整对话流解析器」缺口(session-search v1 只索引用户消息,注释明写助手正文二期)。
2. **大仙**:要完整的会话解析,完全参考 monocode(`~/code/AI/github/monocode`)的历史会话解析。
   **探底结论**:monocode 自己驱动 CLI、把对话存成自有 Block[] 模型(不解析外部磁盘 JSONL);值得完全参考的是它的 **Block 类型体系 + 转录渲染形态**(role 分块/tool 卡带 diff/thinking 折叠/游标分页)。tmd-cli 需自写各家 JSONL → Block[] 解析器。
3. **CLI 覆盖**(选项:先两大族/一次全量/单家试点)→ **大仙选:一次全量**(10 插件 6 解析器)。
4. **入口范围**(全部行/仅历史行)→ **大仙选:全部行**(活会话读快照,手动刷新)。
5. **设计四段**(方案取舍/架构/错误处理/验证)呈现 → **大仙批准开工**,附加要求:严格插件化、完全参考 monocode、兼容性/边界/性能纳入管理、避开并行 AI 的在途改动。

## 关键决策记录

- 独立 session-viewer 插件 + kernel tab 契约(仿 fileTabs)+ CliProfile.readSessionTranscript 声明式适配器;否决 kernel 行挂点(单消费者投机)与并入 workspace(违反标准路径)。
- dsh 会话是 zstd 压缩 JSONL → JS fzstd 解压,不碰 src-tauri(并行会话占用)。
- 六族行型全部本机实证后编写解析器(spec 附录有表),grok 工具行未实证按「宁漏勿误」跳过。
