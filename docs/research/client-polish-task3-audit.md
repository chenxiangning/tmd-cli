# 客户端打磨任务3 五路审计(UI 整体效果:排版/间距/形制/动效/色彩层次)

- 日期:2026-10-02
- 状态:已完成(处置见同日 spec;用户拍板=正文 12px、全量三梯队)
- 范围:任务1/2 未覆盖的视觉一致性维度;五路只读审计(排版阶梯/间距密度/形制语言/动效与状态/色彩层次),量化数据均经程序化 grep 统计
- 性质:能力调研,零代码改动

## 结论先行

前两轮把交互缺陷与颜色语义 token 化收口后,「整体效果」的短板暴露为**缺一套设计系统**:字号 27 个等价值、正文 11/12px 双轨各约 450 处对半;间距 36 档无栅格;圆角 token 化率 44%;动效时长 11 档、弹层零入场、空态无图标无引导;色彩浮层族 bg 档分裂、选中态五范式、浅色主题 muted/subtle 对比不足(4.05/2.77)。**根治 = token 阶梯(字号/间距/圆角/动效)+ 层次模型 + 状态三原语(Empty/Spinner/错误契约)+ 全仓批量迁移**。

## 一、排版与字号(25 项)

- 约 1400 处字号声明收敛后 27 个 px 等价值,9-14px 挤 18 个;token 化率 <1%(--tmd-font-ui 仅 6 处消费)。
- **正文双轨(P1)**:壳层 CSS 0.6875rem(11px)×221 + text-[0.6875rem]×172 + text-[11px]×39 ≈432 处;插件 TSX text-xs(12px)×328 + 0.75rem×148 ≈476 处;同屏 1px 跳变。
- 孤档:11.5px(0.71875rem 三种写法)、10.5px(0.65625rem 约 55 处)、0.68/0.7/0.72rem 手调值;daily-journal 一家 8/8.5/9.5/10px 四档微字号。
- 等宽三轨:--tmd-font-mono×25、Tailwind font-mono×105(平行变量不随主题引擎)、ui-monospace 直写×51;自造 --code-font-family/--font-mono 16 处。
- 行高近 30 种(任意小数+px 魔法值);字重 650 非标×5、面板标题 400/500/600/700 混用。
- 建议阶梯:2xs 9 / xs 10 / ui 12(正文,用户拍板)/ md 13 / lg 14 / xl 16 / title 20;markdown em 相对制保留;代码内联 11 块 13。

## 二、间距与密度(25 项)

- 1550 处字面量、36 档(2-28px 平均 1.14px 一档);孤值 3/5/7/9/11/13/15/17/21px 约 218 处;themes.css 间距零 token。
- 最伤节奏:**右栏同 rail 四面板容器 8/12/16 三档密度跳**(SkillHub p-2 → Memory p-3 → Checkpoints px-4);**中央 tab 页边距四套**(settings 36/40/64、market 28/24/80、welcome 10/16/24、viewer 14/16/24)且 px/rem 双单位;**行高 22/24/26/28 四轨同屏**(titlebar/tab-bar/toolbar/file-tree)。
- 命中区:file-tree-action 18×18、tab-close 16×16、journal 图片删除钮 14×14 均 <20 无外扩。
- 建议:--tmd-space-1..6(4/8/12/16/20/24)4 栅格;行高 24(顶栏/tab/菜单)/ 28(列表)两档;图标钮统一 24 方形(rail 26 唯一例外)。

## 三、形制语言(25 项)

- 圆角:token 三档(6/8/12)已有但同值写死约 127 处(化率 44%);档外碎片 3/4/5/7/9/10px 约 110 处;**Tailwind rounded-md=6px=radius-sm 名值错位一层**,@theme 未映射;10px 卡片档与 8/12 三层并存;pill 999/99/9999 三写法;--sidebar-row-radius/--radius-lg 平行 token。
- 边框健康:1px×357 主流;五套旧别名(--border 系)各自映射;约 10 处写死色;mobile 树独立(声明保留)。
- **图标第二重灾区**:504 实例 9-16px 连续 8 档(12/13/14 难辨),px 数字与 rem 字符串双轨同值双写;weight fill/bold/duotone 同场景混用;同场景刷新钮三种尺寸。
- 滚动条最健康:global.css 唯一方案,隐藏例外 5 处散写可收敛 utility。
- badge:圆角三分支、边框策略两种、padding 六种、字号五档。
- 建议:圆角 xs4/sm6/md8/lg12/pill999 五档 + @theme 映射;图标 10(密集例外)/12(行首)/14(按钮面板头)/16(工具钮)四档统一 rem 写法;weight 规则默认 regular/激活 fill/强调 bold/duotone 仅空态。

## 四、动效与状态呈现(25 项)

- 时长 11 档(120ms 主流 70 处);缓动 7 种(35 处缺省 ease 混排);同语义 hover 消隐 120/150/200 三档;caret 旋转 4 档。
- **DialogShell 族弹层零入场动效**(git/cli-config/omp 全走它);全仓零离场动效;入场 keyframes 五式混用。
- **spinner 四形制**:九点阵、CircleNotch+animate-spin×25、9 份重复 rotate360° keyframes(5 种时长)、盲文字符 spinner(80ms JS interval);加载文案 7 种写法。
- **空态 6+ 形制全部无图标无引导钮**(字号/颜色/对齐/边框盒混用);HistoryView 空态与错误共用一行灰字。
- 取数失败 6 形制(红字±重试/灰字/持久条/toast);toast 第 4 套自管实现。
- :active 按压全仓仅 4 处;**focus-visible 无全局 ring,outline:none 70 处裸拆**。
- 建议:三档 120/180/240ms + 两根曲线 token;DialogShell fade+rise 180ms 入场;global 一份 tmdSpin;kernel Empty/Spinner 原语;错误契约(可重试=持久条+重试/瞬态=toast/校验=红字);全局 :focus-visible ring 与 button:active 按压。

## 五、色彩层次与质感(25 项)

- **浮层族断裂**:同为浮出菜单一半 bg-popover 一半 bg-elevated(石墨下可见明暗差);模态四档底(popover/panel/elevated/base);DialogShell=popover 为基准。
- **选中态五范式**:accent-soft 底(会话/分支)、bg-active 底(tab/导航)、bg-hover 底(文件树=与 hover 同色深色下不可辨)、仅文字 accent(styled-select)、写死橙 rgb(255,140,60)×8;themeTokens 里 bg-active ≡ accent-soft 同值双 token。
- **浅色三主题对比偏弱**:fg-muted 4.05-4.73(mist/linen<4.5)、fg-subtle 2.77-3.13、三档区分度被压缩;fg-faint(1.7-1.9)被误用于真实文案(路径/时间戳/空态/占位符)。
- 阴影漏网:Tailwind shadow-lg/xl/2xl 约 20 处 + 手写 14 处;settings-cluster/version-popover 50% 黑影浅色下成黑晕。
- 静态面板全窗 bg-base 扁平口径(侧栏 preset 色未消费);壁纸模式 elevated 不打穿致实底贴片层次倒挂。
- 建议:L0-L4 层次模型(窗底 base/常驻 panel/卡片 elevated 或 sunken/浮层 popover/模态 popover+shadow-modal);选中=accent-soft 底+fg 文字+weight600;hover=bg-hover 纯色;浅色 mix 系数收紧(0.34/0.48/0.68→约 0.28/0.42/0.62);faint 限纯装饰;QR 白底加框、图片 sunken 垫底;text-white 全改 accent-fg。

## 处置

见同日 spec:用户拍板正文 12px、全量三梯队;基座 token 先行,壳层/插件 CSS×3 批 + 壳层/插件 TSX×2 批 + kernel 原语批并行;mobile 树维持独立 token 体系(注释声明);bg-active 与 accent-soft 保留双名文档合一;壁纸 elevated 打穿(card 档)留观。
