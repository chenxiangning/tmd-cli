# CLI 独立配置 实施计划

对齐 `openspec/changes/cli-gui-config/proposal.md`。每项完成即勾。

## 1. 内核契约

- [x] `kernel/cliConfigRegistry.ts`:条目类型(FieldSpec: text/select/toggle/secret + 复合型 modelMap/orderedList + rawEditor 声明 + file/files 多配置源)+ 订阅注册表(重复 id 抛错、order 排序,镜像 settingsRegistry)+ 单测
- [x] `kernel/plugin.ts`:PluginContext 增 `registerCliConfig`;plugin 测试桩补该方法

## 2. cli-config 聚合插件

- [x] `cli-config/index.tsx`:注册 section `cli-config`「CLI 独立配置」(单 tab);`allPlugins` 注册一行
- [x] `cli-config/EngineTabs.tsx`:useCliConfigEntries 驱动的引擎子 tab 条(图标 + 名称)+ entry.files 多配置源切换 chips(全局/项目级)
- [x] `cli-config/ConfigForm.tsx`:通用表单渲染(text/select/toggle/secret 眼睛切换/advanced 折叠分组/说明行)+ 复合控件(modelMap 角色表、orderedList 有序链)+ GUI/原始双模式切换(CodeMirror,由 rawEditor 声明驱动)+ 脏跟踪保存条(放弃/保存)+ toast
- [x] `cli-config/io.ts`:configHomeDir + fsReadFile 读 → load → save → 首写 `.bak-tmd` 备份 → fsWriteFile;解析失败/文件缺失错误态 + fsRevealInFileManager 入口(含单测:备份只建一次)

## 3. 四引擎贡献

- [x] `cli-omp/configGui.ts`:models.yml 行级候选解析 + modelRoles 角色表 load/save(值 = provider/model:思考强度后缀,全角色增删改)+ schema(单测:多角色快照往返、未托管段逐字保留)
- [x] `cli-omp/configGui.ts`:retry.modelFallback + fallbackChains 链表补丁(插行/删行/排序)+ 平面键(defaultThinkingLevel/symbolPreset/prewalk/compaction/memory/checkpoint/security/ttsr×4/webSearch)(单测:链表增删排序、ttsr 段往返)
- [x] `cli-omp`:activate 注册 + `rawEditor: yaml` 声明 + files 多源(项目级 `.omp/config.yml` 不存在时空态,首次保存创建)
- [x] `cli-pi/configGui.ts`:settings.json JSON 合并 load/save + schema(单测:未知键保序保留)
- [x] `cli-claude/configGui.ts`:env 七键 + 顶层键 JSON 合并 load/save + schema,secret 不回显明文(单测:hooks/permissions 原样)
- [x] `cli-codex/configGui.ts`:TOML 顶层平面键行级补丁 load/save + schema(单测:含 [projects] 注释段样本逐字保留)

## 4.5 缺陷整改(2026-09-09 二轮)

- [x] StyledSelect 共享控件(kernel):主题化按钮+卡片弹层(搜索/禁用/徽标/右侧对勾),cli-config 全量替换 + 外观/行为页原生 select 一并清除;修复样式漏 @import 裸奔事故
- [x] 模型选择两级化(供应商 → 模型 [→ 思考强度]),与配置解耦:`catalog` 契约 + ModelPicker;omp = `omp models --json` 登录实况 ∪ models.yml 已配置;pi = auth.json×models-store.json;claude = env+~/.claude.json 历史;codex = [model_providers] 节+目录文件
- [x] 修复 StyledSelect Esc 穿透关面板(React 合成层拦截);触发器不渲染徽标(仅选项内)
- [x] 评审三路 findings 全修(omp 空键毁文件/codex 静默丢写/内核引号+# 与 flow-map 与行内注释/有序链连带删/读失败三态/保存基线重同步)

## 4. 验证

- [x] 全套前端门禁:typecheck / test / check:arch-boundary / check:file-size / build
- [x] 浏览器桩目检:四 tab 读写往返、脏跟踪、备份生成、解析失败错误态;omp 角色表增删 / 链排序 / 原始模式往返
- [ ] `pnpm tauri:dev` 真窗:omp 改 modelRoles 角色与回退链、claude 改 env 各一项,`omp config get modelRoles` 与 CLI 侧确认生效、未托管内容无损
