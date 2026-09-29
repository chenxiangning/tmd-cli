# 通用技能关联设计(composer 级联 = 管理端已装闭环)

日期:2026-09-28
状态:已实现(v2;1421 桩端到端过:0 起步→导入→已装 1→omp/claude 级联;真机 tauri:dev 复验留大仙)

## 背景与目标

skill-hub 首版把「十家 CLI 目录只读扫描」直接当已装列表展示,composer 直接聚合
十家目录 —— 语义错:管理面与对话框没有闭环,本机 CLI 目录的 skill 不是
「tmd 装的」。

正确模型(用户定,LiveAgent 语义适配宿主场景):

- **管理端「已安装」= tmd-cli 自己的安装记录**(商店安装 or 本地导入),
  初始 0;
- **本地导入** = 把本机各 CLI 目录的既有 skill 导入:复制落位(公约位/所选
  引擎目录)+ 写安装记录(关联关系);
- **对话框($ 触发/抽屉)级联 = 管理端已安装集**(∩ 当前 CLI 可用)——闭环;
- **PTY 内部零改动**(skill 真身落在各 CLI 目录/公约位,CLI 原生识别)。

## 方案取舍

选定:**自有安装记录 + 导入落位 + composer 查记录**。
- 记录 = ~/.tmd-cli/installed-skills.json:{name, description, source(store|
  import), targets(home 相对落位路径), createdAt};记录是关联关系,skill
  内容真身在各 CLI 目录/公约位(tmd 不做内容真相源)。
- composer 候选 = 记录 ∩ 当前 profile 可用(targets 含该引擎目录,或公约位
  且该引擎 readsShared;claude 需 targets 含 .claude/skills symlink)。
  物理正确:发出去的 $token CLI 必须认识。

被否决:
- v1 十家目录直接聚合 + 选中落位:无管理边界,已装/未装无区分,闭环断裂。
- composer 出全部已装不过滤:omp 会话发只在 ~/.claude/skills 的 skill,
  CLI 不识别,发送无效。

## 设计

1. **记录层** `cli-shared/skillRegistry.ts`(composer 与 skill-hub 双消费,
   准入先例):load/save + subsubscribable store;fs 读写走 kernel ipc。
2. **skill-hub 三视图**:已安装(记录渲染,删除 = 记录-落位目录入回收站)/
   技能商店(现有,安装完成写记录)/ 本地导入(发现层 scanAllSkillSources
   列源 → 导入弹窗选目标 → fsCopyTree 落位 + 写记录)。
3. **composer**:drawerItems/suggest 的 skill 动态层 = 记录可用集;
   v1 的落位确认闸/PlacementConfirm/十家聚合拆除(universalSkillSuggestions
   改为记录→候选)。
4. **落位原语**(v1 批次已完成,全部复用):Rust fs_copy_tree(32MB 闸)、
   placeSkillToShared(公约位+claude symlink)。
5. PTY 零改动。

## 验证

- 单测:registry 读写/记录去重;composer 可用性判定(公约位 readsShared/
  claude symlink/自家目录);导入编排落位+写记录序。
- 桩目检:已装 0 起步 → 本地导入(选公约位)→ 已装 1 → omp 会话 $ 触发级联
  出该 skill → 发送 $token;claude 会话公约位 skill 需 symlink 落位才级联。
- 门禁:typecheck / test / arch / file-size / build / react-doctor 100。
