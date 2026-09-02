## 1. 共享层

- [x] 1.1 `cli-shared/qoderSessions.tsx`：slug / 目录定位 / 会话列表 / 会话状态提取（runtime-config + assistant 双帧型，跳过错误帧）/ settings.json 默认状态解析 / QoderGlyph
- [x] 1.2 `cli-shared/userMessages.ts` 增加 `qoderUserMessageLine`（origin.kind=human 守卫）

## 2. 插件

- [x] 2.1 `cli-qoder/`（国际版：qodercli + ~/.qoder）
- [x] 2.2 `cli-qoder-cn/`（国内版：qoderclicn + ~/.qoder-cn）

## 3. 注册

- [x] 3.1 `plugins/index.ts` 注册 cli-qoder + cli-qoder-cn
- [x] 3.2 `welcome/engineMeta.ts` 追加双引擎元数据

## 4. 验证

- [x] 4.1 共享层纯函数单测（slug / 状态提取 / settings 解析 / 行型）
- [x] 4.2 双插件接线单测（profile 契约）
- [x] 4.3 typecheck + 全量测试回归（基线 418 → 436 全绿）+ 真实磁盘冒烟 6/6（临时文件已删）
