# 手机会话时间线提交后评审

- 日期:2026-10-05
- 对象:01cb1384(feat(mobile) 会话时间线 sheet)+ 本轮修复
- 评审方式:对抗性自查(数据契约逐环核验 + i18n 全词条审计 + 竞态/口径差推演)

## 结论

2 实锤(1 P1 + 1 P2)当轮修复;其余核查面全过。门禁复验全绿(typecheck / 3650 测试 / arch-boundary / file-size / react-doctor 100)。

## 实锤与修复

### P1 超 600 字消息恒置灰(口径差是确定性阈值,非偶发)

- 现象:kernel transcript 的 user turn 经 `clipText` 在 600 字(TURN_MAX)截断加 `…`;时间线侧 `m.text` 是原文无截断。全等判定对超长消息**必然失败** → 恒置灰不可跳转。长需求消息恰是回顾主对象,spec 里「口径偶有差 = 置灰降级」的理由对确定性阈值不成立。
- 修复:kernel/transcript.ts `clipText` 导出(消费方须与 turn.text 同口径归一);TimelineSheet 可达判定改 `reach.has(clipText(m.text))`,SessionScreen 跳转 DOM 匹配改 `textContent === clipText(text)`。
- 回归:`timelineSheet.test.ts` 双断言钉死(clip 归一后可达 = true;原文直比 = false)。

### P2 新词条 en/ja 词典缺失(3 条)

- 「等待会话身份绑定…」「尚未找到会话记录文件」「会话较长,仅显示最近 {n} 条」不在 locales,英文/日文环境回落中文串。补 `locales/{en,ja}/mobile.ts`(「时间线」「还没有用户消息」「读取失败」「重试」「加载中…」经查已覆盖)。
- 教训:目检桩默认英文环境,tiles 显示 "Timeline" 是词典已有;新增 t() 词条必须同步 grep en/ja 词典,不能凭「核心词已存在」推定全组已迁移。

## 核查通过面(要点)

- **Rust 尾读契约**(fs_tail.rs):`size` = 文件总字节数(非读到字节数)→ 截断判定 `size > 2MB` 正确;`lastSize = None` 强制读恒 changed=true,不落入「changed=false 空 text 被当 0 条用户消息」的错态。
- **跳转竞态**:reach 在 render 内计算,turns 后到(40 轮尾窗拉回)自动灰转亮;jumpToMsg rAF 后 DOM 稳定;卸载后 setState 无害(React 18)。
- **重复打开 sheet 重复拉 2MB**:spec 既定「打开拉一次」,外网回顾场景可接受,留观(不做 mtime 缓存,YAGNI)。
- **kimi parser import 链**:mobile 树 import `@plugins/cli-kimi/kimiSessions` 与 transcript 消费 codex/kimiTranscriptLine 同先例(适配器/纯函数模块准入),无 UI/生命周期引入。

## 留观(不修,理由)

1. **多 text part 消息**:kernel pushParts 把多 text part 拆多 turn,userMessages 侧可能合并 → 极长尾口径差置灰。单段输入是绝对常态,多段属罕见形态,置灰可读不误导。
2. **turns 增长挤出尾窗竞态**:reach 判定 ok 后、点击前新消息到达把目标挤出 40 轮尾窗 → DOM 无匹配静默(防御路径,注释已明)。概率极低且无错跳。
