# 31 · tab 右键菜单分组化契约(通知/会话操作/标签页三级结构)

日期:2026-10-20 · 状态:已落地(0.4.1,commit 5d5d0bd5)

## 结构

会话 tab 菜单 12 行平铺收成 6 行:

```
重命名
置顶到全局 / 取消置顶
通知     ▸  取消静音(如已静音) / 静音通知 / 完全静音 / 静音至回合结束
会话操作 ▸  查看会话转录(只读) / 转到其他引擎接力… / 在左侧栏定位会话
标签页   ▸  平铺显示(取消平铺) / 关闭其他 tab / 关闭全部 tab
──────────
关闭
```

文件 tab 菜单仅关闭族(关闭/关闭其他/关闭全部),保持 3 行平铺不变。分组判定 = `menuLayout`:任一会话能力(onRename/onTogglePin/onView/onRelay/onLocate/muteKey/onToggleTile)在即 grouped,否则平铺。子菜单行集仍按 prop 在否条件渲染(如 onView 缺席则「查看转录」不出),与分组前同语义。

## 文件分层(300 行铁则 + react-doctor 双驱动)

| 文件 | 职责 |
|---|---|
| `app-shell/TabContextMenu.tsx` | 壳:portal/backdrop/Escape/视口夹取(clampPosition)+ 顶层高频行(重命名/置顶/关闭) |
| `app-shell/TabMenuGroups.tsx` | GroupedRows(三分组 + 尾分隔线)/ CloseRows(关闭其他/全部,平铺态与标签页子菜单共用) |
| `app-shell/TabMuteMenu.tsx` | MuteMenuRows 静音组(取消静音 + 三档位,当前档 ✓ 禁用) |
| `app-shell/tabMenuLayout.ts` | menuLayout 纯函数(分组判定 + 夹取高度估算,行 30 + 分隔线 14) |
| `app-shell/wsmenuSubmenu.tsx` | 行原语:MenuRow(单行)/ SubmenuRow(二级子菜单行) |

两条硬约束的出处:

- **react-doctor no-high-complexity-react-function**:主组件渲染分支过多即标红(93 分教训)——分组区/顶层行必须拆子组件,主组件只剩壳。
- **react-doctor non-component export**:纯函数不得与组件同文件——menuLayout 独立 `.ts`。

## SubmenuRow 二级子菜单范式(app-shell 本地版)

范式同 `plugins/files/FileDetailGitSubmenu.tsx`(wsmenu-submenu-host + wsmenu-submenu),但 app-shell 不依赖插件模块,按 TabContextMenu 先例本地实现(clampPosition 同款先例):

- hover 展开(onMouseEnter),`position: fixed` 逃逸 `.wsmenu` 的 overflow-y 剪裁;
- 右侧放不下翻左(`r.right + W + 8 > innerWidth` 判定,W=176),纵向夹取;
- 飞层是 host 的 DOM 子节点——移入飞层不触发 host mouseleave,不需要延迟关闭;
- host 行 = `wsmenu-item` + CaretRight(`wsmenu-item-kbd` 槽),点击不关菜单。

复用规则:app-shell 后续任何菜单要二级子菜单,直接用 `wsmenuSubmenu.tsx` 行原语,不再复制第三份;插件侧仍用 plugins/files 自己的实现(R4 禁反向依赖,不回改)。

## 词条

「通知」「会话操作」为既有全局词条(kernel/locales workspace.ts 与 plugins/notify),新增「标签页」(en: Tabs / ja: タブ)于 `kernel/locales/{en,ja}/common.ts`。
