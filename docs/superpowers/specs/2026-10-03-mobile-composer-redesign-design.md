# 手机对话输入区三态重做设计(豆包式胶囊 composer)

日期:2026-10-03
状态:已实施(真机目检留大仙)

## 背景与目标

会话屏 composer 现状是「拖拽把手 + 52px 小缩略图行 + [⌨|图|输入框|↑] 方框 + 键条」:
信息密度高但形制旧,与主流手机 IM(参考豆包三张示例截图)差距明显。本次按示例图
重做为三态胶囊输入区:

1. 常态胶囊条:左相机钮(实为相册选图)+ 输入框 + 右侧键条开关 + 加号/发送蓝圆;
2. 挂图态:大圆角缩略图卡(右上深色 ✕,尾随「+」瓷砖再加一张)+ 挂图提示 chips
   (提取图中文字 / 图片配文 / 翻译图中文字);
3. 「+」面板:输入条**下方**展开四格大按钮(参考图2 条上面下;相册 / 切模型 /
   检查点 / 快捷键);四格动作执行后一律收起(连加图走缩略行「+」瓷砖),
   面板展开期间键条让位,软键盘弹起自动收面板。

目标:视觉与交互对齐参考图,同时全部能力落在现有桥与 session_write 通道上,
不动 Swift 壳、不动 AppDevice 白名单、不动发送契约。

## 方案取舍

选定:纯前端重排,Composer 独立组件 + 独立 CSS 文件。

- 三态全用现有能力:相册 = 既有 pickImage 桥;切模型 = 填 `/model` 草稿(发送后
  键条驱动 TUI,既有用法);检查点 = 既有 CkptSheet;快捷键 = 既有 KeyToolbar。
- 组件落点:`src/mobile/Composer.tsx`(展示型三态组件,状态留在 SessionScreen,
  同 SessionHeader「纯展示、状态在父」先例);SessionScreen 现 299 行贴 300 行
  铁则,拆出后两侧留余量。ShotStrip / SendErrBars 随迁,ShotPreview 留
  SessionChrome(独立全屏浮层,与 composer 无布局耦合)。
- 样式落点:新建 `mobile-composer.css`(mobile.css 266 行装不下,先例
  mobile-sheet.css);错误条/挂图卡/chips/面板样式随 composer 家族整体迁入,
  类名以 `cp-` 前缀起头,旧 `.grabber`/`.kb-toggle` 样式删除。
  **挂链铁则(二轮真机反馈教训)**:mobile css 家族有且只有两个入口挂链点
  `main.tsx`(mobile 分支)与 `mobileMain.tsx`(壳专用入口),新增文件必须
  两处同步——漏 main.tsx 一处,手机经双态入口加载即整块零样式。
- 交互契约保持:裸 Enter 换行、⌘/Ctrl+Enter 发送(mobileEnterAction 不动);
  发送失败保草稿 + 悬浮错误条重试不动;16px 输入字号防 iOS 聚焦放大不动;
  键条在软键盘弹起时隐藏不动(键条本体移由 Composer 渲染,DOM 位置不变)。

被否决:

- 照抄参考图补齐「按住说话 / 相机拍照 / 文件 / 打电话」:壳只有 pickImage,
  语音需 ASR、拍照与文件需新 Swift 桥,均超本次范围;做禁用占位则是死钮,
  违背「面板四格全部可用」的决策(大仙 2026-10-03 拍板全用现有能力)。
- chips 点击直接发送:CLI 会话一击即发无法补充说明,误触成本高;选填草稿
  聚焦、由人按发送。
- 保留拖拽把手:胶囊条形制与把手互斥;自动长高(约 2 行起步、132px 封顶)
  已覆盖长文场景,useComposerSize 随之删除。
- 「+」在有内容时仍显示:与参考图一致让位于发送蓝圆;面板动作(相册/切模型
  等)在空稿时触达,挂图场景由缩略行「+」瓷砖与相机钮覆盖。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- `npx react-doctor@latest -y` 得分 100。
- Composer.test.tsx:三态渲染契约(常态 + 号/挂图 chips 表与「+」瓷砖/面板四格
  与置灰)+ chipPrompt 提示词映射纯函数。
- 浏览器目检 mobile 入口三态交互;真机(iOS 壳)目检留大仙:软键盘弹起收面板、
  键条显隐、纯图发送。
