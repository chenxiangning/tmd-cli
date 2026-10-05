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

## 真机首轮反馈修复(读取失败,2026-10-05 晚)

- **现象**:真机开时间线 sheet 报「读取失败」。根因(预算链推演):2MB 尾窗响应帧
  经 JSON 封包转义(反斜杠/引号翻倍)+ 中继 b64(×1.33)膨胀至 ≈4MB,撞手机壳
  4MiB 收帧上限(PHONE_MAX_FRAME,壳侧常量;桌面无响应守卫,relay_core 注释为
  设计意图未实现)→ 手机收不到响应帧 → invoke 15s 超时 reject。读头风暴同族
  教训:当时只守了请求侧 3.5MiB 上行,响应侧膨胀漏算。
- **修复**:读窗 2MB → 512KB(封包后 ≈1MB,4G 稳过 15s;用户消息密度低,512KB
  容数千条 ≈ 全程覆盖);失败态新增错误细节行(message 前 120 字),不再黑盒。
- **桩回归**:假 WS 桥全链 DOM 断言过(条目列表最新在顶/点击跳转关 sheet)。
  桩侧另复现「home.replace is not a function」= 桩缺 config_home_dir 命令,
  ompSessionsDir(edits.ts)对非 string home 调 .replace;真机 dispatch 有该
  命令不受影响,非产品缺陷(记录备查:桥下未列命令的兜底形状陷阱)。

## 真机二三轮复盘(2026-10-05 深夜,两笔 8e86d7c4 后的真机实锤链)

三轮真机各炸一个环,全部是「桌面全套绿、只有真机炸」的桥接语义盲区:

1. **白名单行被顶(fe65b9b8 修)**:加 `fs_read_range` 时编辑指令 PUT 34.=34
   语义是替换,把 `fs_read_tail_changed` 白名单行顶掉 → 「app 设备不在允许域」。
   旧测试只有单向(白名单→桥臂);补 fs + git 两域反向漂移测试(桥臂必在
   白名单或显式豁免集),顶行本地即红。
2. **serde 契约缺环(84bd2d97 修)**:`ReadRange` 参数 struct 漏
   `#[serde(rename_all = "camelCase")]` → TS 传 maxBytes,Rust 要 max_bytes →
   「参数错误: missing field max_bytes」。桩/mock 不过 serde、Rust 单测直调
   函数也不过 serde,四道防线全盲;补 dispatch_fs.rs serde 契约测试组
   (camelCase JSON 必须成功 + snake_case 必须报错,新参数 struct 登记一行)。
   顺带钉死:clippy 的 non_snake_case 对「中文+下划线」放行、混入 ASCII 驼峰
   (camelCase)才报,测试函数命名全中文或全 snake_case。

**教训(通用)**:桥接链每一跳的「隐式契约」(serde 改名、域闸白名单、壳帧上限)
在桌面环境全部不可见,桩与单测天然盲区;每炸一环必须把该环契约固化为本地
红绿测试,并横向扫同族(dispatch_fs 全 struct、git 域全臂)一次修净。
错误细节行(8e86d7c4)是这轮唯一能让真机一步定位的功臣——黑盒失败态的代价
是三轮往返,保留并推广。
