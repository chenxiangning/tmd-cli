# 0.3.2 W1+W3 工作区终审(三路并行复审)

日期:2026-10-07
状态:已收口(2 major + 5 minor 全修,3 nit 修 2 留 1)

## 结论

对未提交工作区全部变更(25 改 + 10 新,约 500 行新增)做三路并行终审:
W1 接力切片(NEEDS FIX)、W3 切片(NEEDS FIX)、入口与文档切片(OK with notes)。
两个 major 均实锤且已修复复验;三套门禁与全量测试修复后全绿。

## Major(已修)

1. **活会话接力源漏传 cwd/workspaceId**(session-relay/index.tsx buildSourceFor):
   tab 条是跨工作区 MRU,右键别的工作区会话接力时,磁盘源定位落空 → 摘要静默降级
   「未提取到历史输入」;新会话也落错工作区。修复 = 组源补两字段(与退出卡路径同
   语义),并新增 index.test.tsx 桥协议测试钉死(activate/cleanup 双桥配对、CLI 组源
   携带 cwd/workspaceId、shell/已退出不开框)。
2. **文章引用标记标题提取指令未剔除行内标注**(daily-journal/promptGen.ts):
   指令允许照抄 (有摘录)/(无摘录)/(已归纳)/(新增) 进标题,而渲染层校验键用干净
   r.title → 主路径(正常生成每行必带摘录标注)下链接系统性降级纯文本。修复 =
   指令显式剔除四类标注与 · 工作区后缀,契约测试补钉;旧「无标注」断言收窄到
   行形态(指令句中的标注枚举不再误伤)。

## Minor(已修)

- RelayDialog 截断黄标注释仍写旧 500 字/8KB 预算 → 改为 RELAY_DIGEST_CAPS/32MB 真机制。
- ArticleTab 文章链接 open 对已删工作区缺守卫 → 与 UnfinishedPanel 同款 `if (!ws) return;`。
- 架构文档 app 树例外条款措辞与其先例矛盾(marks/store 是有生命周期数据面,非纯
  函数)→ 条款补「经兄弟插件 store 声明的具名数据函数做窄口读写」口径。
- 新入口闸口零测试 → 桥协议测试(见 major 1)。
- 退出卡/菜单/命令三入口措辞不一(「转其他引擎接力」vs「转到其他引擎接力…」)→
  统一为后者,common 词典旧键删除,check:i18n-keys 缺键 0。

## Nit

- 已修:TabContextMenu 头注补 onRelay 枚举;sessionDigest 换壳遗留 re-export
  (capLine/DigestCaps)删除,测试改 @kernel/transcriptDigest 直连。
- 留观:daySessions 扫描落定后转活的双行瞬态(≤60s 窗,自愈于重扫,
  openDiskSession 内部去重兜底);评审冻结记录中一处行号漂移(boardData.ts:10 → :15)。

## 遗留(不阻塞,下批顺手)

- W1 P2 补测:truncated 双旗叠加、dsh relay fixture、overlay 编辑 round-trip。

## 验证

pnpm typecheck 0 错;pnpm test 3740 全绿(新增桥协议 3 测);check:file-size /
check:arch-boundary / check:i18n-keys(缺键 0、不对称 0)/ react-doctor 100 全过;
1421 真壳目检 tab 右键菜单行 + 接力面板开启链路(见会话记录)。
