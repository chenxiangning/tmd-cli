# 手机选图上传反馈与相册/拍照双入口设计

日期:2026-10-03
状态:已实施(真机目检留大仙)

## 背景与目标

真机反馈三连(大仙 2026-10-03):

1. **选图后交互空白**:选完图要等「JS 压缩 → 桥帧上传 → 桌面落盘」全程 1~3s 才见
   缩略卡,期间唯一反馈是按钮禁用,用户以为中断;
2. **入口图标名不副实**:胶囊条选图入口用 `Camera` 照相机图标,实际是相册选图;
3. **缺拍照能力**:照相机图标的语义(拍照上传)无对应实现,壳只有 PHPicker。

目标:选完图立即上屏 pending 缩略卡(原图即时预览 + 转圈遮罩)消除空白期;
胶囊条改双入口 = 相册(`Images` 图标,pickImage)+ 拍照(`Camera` 图标,新原生
`takePhoto`);上传期间禁发送防「图没挂完就发出去」。

## 方案取舍

选定(大仙三项拍板均取推荐项):

- **pending 形态 = 原图即时缩略卡 + 转圈遮罩**:picker 回传 blob 即刻 objectURL
  上屏,所见即所选;完成/失败/取消后替换/撤除并释放 URL。占位灰卡(被否决)
  反馈信息少,不知选了什么。
- **双入口并排胶囊条**:`[Images 相册][Camera 拍照]` 两 icon 一眼可见、一键直达;
  只进「+」面板第五格(被否决)多一步触达且面板是瞬时菜单语义。
- **拍照走 iOS 原生新桥 `takePhoto`**:`UIImagePickerController` 相机拍摄,
  复用「限边 2048 转 JPEG → base64 → `{b64}`/`{cancelled}`」回传链路与 JS 侧
  pickResultToBlob 分流;新 CameraRelay 同 FilePanelRelay 的持活/恰一次收口契约。
  只改前端(被否决)则拍照钮是死钮,违背「面板全部可用」先例决策
  (2026-10-03 重做 spec 当日否拍照仅因超范围,本次大仙明确要求补齐)。
- **上传中禁发送**:pending 存在即 `disabled`,杜绝竞态(文字先发、图片落单挂起);
  不禁(被否决)用户可见 loading 仍可能手快先发。
- 错误文案按图源区分(选图失败/拍照失败),错误条机制复用不动。
- Android 壳本次不做:现状连 pickImage 都无,iOS 先行(与选图能力现状对齐)。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- `npx react-doctor@latest -y` 得分 100。
- remote.test.ts:takePhoto 结果分流复用 pickResultToBlob;attachShot pending
  生命周期(开始即挂 pending、成功替换、失败撤除、取消无 pending)。
- Composer.test.tsx:双入口 icon 在场;pending 卡渲染;上传中发送钮禁用。
- Swift 本地语法级检查(xcodebuild/swiftc);真机目检留大仙:拍照权限首启弹窗、
  拍摄→pending→完成无缝替换、取消静默、模拟器相机不可用报错条。
