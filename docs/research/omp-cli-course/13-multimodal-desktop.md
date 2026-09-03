# 第十三课:browser + computer + 多模态

omp 的 20 + 21 号电池,以及多模态工具集——agent 不止能写代码,还能**操作桌面和生成/理解多媒体**。注意:这一课的工具**几乎全部默认关**,要用配置打开(见 §5)。

## 1. browser 工具(20 号电池前半)

### 1.1 三种连接目标

| 目标 | 含义 | 适用 |
| ------ | ------ | ------ |
| headless Chromium (无头浏览器, 后台跑) | 项目共享、broker 托管、带 stealth 补丁 | 后台抓数据 |
| CDP-attached 应用 | 通过 Chrome DevTools Protocol 附加任意 Electron 应用 | 操作 Slack / VSCode / Notion |
| Chrome relay | 用**你自己**开着的 Chrome(装 `omp browser-relay` 扩展) | 不偷焦点、复用 cookie/登录态 |

### 1.2 工具形态:open → run → close

`browser` 不是"发一条指令"型工具,而是**持有标签页、跑 JS** 型:

```js
// 1. 打开一个命名标签页(标签页跨调用存活)
browser { action: "open", url: "https://example.com", name: "scrape" }

// 2. 在标签页里跑 JS:code 有完整 Node 能力 + tab 辅助 API
browser { action: "run", name: "scrape", code: `
  const items = await tab.extract(".item");       // 结构化提取
  await tab.click("text/下一页");
  return items;
` }

// 3. 用完释放(close 加 kill: true 连浏览器进程一起退)
browser { action: "close", name: "scrape" }
```

tab 辅助 API 一瞥:`observe()`(无障碍树)、`ariaSnapshot()`、`screenshot()`、`click/type/fill/press`、`waitForSelector/waitForNavigation`、`extract`。复杂操作直接写 puppeteer 风格代码,不靠参数堆砌。

### 1.3 stealth (隐蔽) 默认开

> "Stealth's on by default, so pages see a normal user instead of a headless bot."——README 原文。

### 1.4 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| Headless browser | ❌ | ✅(stealth 补丁) |
| Electron app 操作 | ❌ | ✅(CDP) |
| Chrome relay | ❌ | ✅(你的真 Chrome) |

## 2. computer 工具(21 号电池)——桌面控制

### 2.1 是什么

**不是** browser 工具。**直接操作你正在用的桌面**——窗口、截图、native input、AX (可访问性) 树、剪贴板。

```
browser   → 在浏览器/网页世界里
computer  → 在 OS 桌面世界里
```

### 2.2 工具形态:持久 JS + desktop API

`computer` 收 `code` 参数,跑的是**持久 JavaScript 上下文**——变量跨调用存活:

```js
// 第一次调用:枚举窗口
computer { code: "display(windows().map(w => w.title()))" }
// → 找到 Slack 窗口

// 第二次调用:接着用
computer { code: `
  const slack = find(w => w.title().includes("Slack"));
  await slack.focus();
  type("会议纪要已发");
` }
```

`desktop` API 能力清单:`windows()`(列举窗口)、`screenshot()`(截屏)、`click()/type()/press()`(native input)、`ax()/find()/ref()`(走 OS accessibility 树定位 UI 元素)、`clipboard`(读写剪贴板)。还有 `read_only` 参数:只读模式直接屏蔽输入/变更。

平台支持:macOS、Linux X11、部分 Wayland、Windows。

### 2.3 实战场景

#### 场景 1:截图 + 视觉模型理解

```js
computer { code: "await screenshot()" }        // 桌面截图
inspect_image { path: "<截图>", question: "屏幕上现在的报错是什么?" }
```

#### 场景 2:跨 app 搬运

```js
// 在 Chrome 选中的内容拷到剪贴板,粘到 Slack
computer { code: "await clipboard.write(...)" }
computer { code: "slackWin.focus(); await paste()" }
```

### 2.4 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| 桌面控制 | ❌ | ✅ `computer` |
| 持久 JS | n/a | ✅ |
| AX 树 | ❌ | ✅ |
| 剪贴板 / Native input | ❌ | ✅ |

## 3. 多模态工具

### 3.1 generate_image(生成/编辑图片)

```text
generate_image {
  subject: "一只穿着宇航服的猫,星空背景",
  style: "photorealistic",
  aspect_ratio: "1:1",
  provider: "auto"        # auto/openai/openai-codex/antigravity/xai/openrouter/gemini/deepinfra
}
```

- 产物写到临时路径并把路径还给 agent;也支持 `input` 传参考图做编辑
- `provider: auto` 会跨**有凭据的** provider 做 fallback 链;单个 provider 返回 0 张图不算错误
- 门控:`generate_image.enabled: true` + 对应 provider 凭据,默认关

### 3.2 inspect_image(本地图片理解)

```text
[用户]
看 ~/Downloads/design.png,这个 mockup 有什么问题?

[agent]
inspect_image { path: "~/Downloads/design.png", question: "这个登录页 mockup 有哪些可用性问题?" }
```

- **path + question 双必填**;支持 `file.svg:img` 这种选择器、附件引用 `Image #3`
- 图片格式按**文件头字节**嗅探,改后缀名骗不了它;上限 20MiB
- **auto-activation (自动激活)**:`inspect_image.mode` 默认 `auto`——主模型**不能看图时**才注册这个工具,能看图时它压根不出现

### 3.3 tts(文字转语音)

```text
tts {
  text: "Welcome to omp CLI tutorial",
  output_path: "~/welcome.wav",
  voice_id: "eve"           # xAI 默认音色
}
```

- 门控:`speechgen.enabled: true`,默认关;`omp say` 命令用**本地**引擎直接合成播放
- 后端(`providers.tts`):`local`(设备上的 Kokoro-82M,只出 WAV)/`xai`(云,MP3 或 WAV)/`deepinfra`
- 坑:本地后端要 `speech.mp3` 会写出一个 `speech.wav`(本地无 MP3);本地后端忽略 per-call 的 voice/language 参数
- 音色以你后端的可选列表为准(README 说 xAI 路线内置五个音色),旧课程里那组 ElevenLabs 风格名字(adam/rachel/...)不要照抄

### 3.4 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| generate_image | ❌ | ✅(多 provider fallback) |
| inspect_image | ❌ | ✅(主模型看不见时自动激活) |
| tts | ❌ | ✅(本地 + 云双路线) |

## 4. 会话开关

不写配置也可以会话内临时开:`/computer` 切换桌面控制。其余工具以配置为准。

## 5. 设置门控(真实键名)

```yaml
# ~/.omp/agent/config.yml
tools:
  xdev: true                # xd:// 设备直调(README 口径)
computer:
  enabled: true             # 桌面控制(高权限,默认关)
generate_image:
  enabled: true             # 图像生成(默认关)
speechgen:
  enabled: true             # TTS(默认关)
github:
  enabled: true             # github 工具(默认关,还需 gh 在 PATH)
security:
  enabled: true             # 安全扫描(默认关)
memory:
  backend: mnemopi          # 记忆工具(默认 off,第五课)
checkpoint:
  enabled: true             # checkpoint/rewind(默认关,第五课)
```

`inspect_image` 是唯一**自动**的——`mode: auto` 下主模型看不见图才出现,不需要单独配。

## 6. 实战综合

```text
[用户]
帮我做一个产品介绍页:先给 hero 图,再把页面截图发我确认。

[agent]
1. generate_image { subject: "...", aspect_ratio: "16:9" }   → hero 图
2. browser { action: "open", url: "http://localhost:5173" }  → 打开本地页面
3. browser { action: "run", code: "await tab.screenshot()" } → 页面截图
4. inspect_image { path: <截图>, question: "排版有什么问题?" }
5. computer(可选):真机浏览器里手动流程的自动化
```

## 7. 与 pi 的全景对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| Headless browser | ❌ | ✅ stealth 默认 |
| Electron 操作 | ❌ | ✅ CDP |
| Chrome relay | ❌ | ✅ |
| 桌面控制 | ❌ | ✅ `computer` + 持久 JS |
| generate_image | ❌ | ✅ |
| inspect_image | ❌ | ✅ auto 激活 |
| tts | ❌ | ✅ local/xAI/deepinfra |

## 小结

| 武器 | 干什么 |
| ------ | -------- |
| `browser` | headless / CDP / Chrome relay,open→run→close 持久标签页 |
| `computer` | 桌面控制,持久 JS + desktop API(默认关) |
| `generate_image` | 多 provider 生图/改图(默认关) |
| `inspect_image` | 看图;主模型看不见时自动出现 |
| `tts` | 文字转语音(默认关) |

和 pi 的对照:**pi 是文本世界,omp 是浏览器 + 桌面 + 视觉 + 听觉**——这是 "IDE-wired" 延伸到整个工作站。

## 下一课预告:第十四课:与 pi 终极对比 + 实战综合

- 21 块电池全景回顾
- 什么时候用 omp / 什么时候用 pi / 什么时候用 opencode
- 学习路径复盘
