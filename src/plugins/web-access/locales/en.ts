/** en 词典 · web-access 域(键 = 中文源串;zh 恒等无词典)。
 *  历史词条在 kernel/locales(settings/settings2),本目录只收新增键。 */
export const MESSAGES_EN = {
  /* 外网引导第③步(真实路径:连接成功后右卡出中继地址;浏览器开地址,配对统一在「设备」页) */
  "右卡连接成功后会显示中继地址,手机用 Safari 打开该地址,加到主屏幕就当 app 用;手机 app 则到「设备」页扫码配对。地址里带的令牌就是钥匙,别转发给别人;用完回这里点「断开」。":
    "Once the right card connects it shows the relay URL — open it in Safari on your phone and add it to the home screen to use like an app; for the tmd-cli app, pair by scanning the code on the Devices tab. The token inside the URL is the key: never share it; press \"Disconnect\" here when done.",
  "右卡连接成功后会显示中继地址,手机浏览器打开该地址,加到主屏幕就当 app 用;手机 app 则到「设备」页扫码配对。地址里带的令牌就是钥匙,别转发给别人;用完回这里点「断开」。":
    "Once the right card connects it shows the relay URL — open it in your phone's browser and add it to the home screen to use like an app; for the tmd-cli app, pair by scanning the code on the Devices tab. The token inside the URL is the key: never share it; press \"Disconnect\" here when done.",
  /* 内网/中继卡的配对入口提示(扫码统一收口在「设备」页) */
  "手机 app 接入:到「设备」页扫码配对,授权后长期有效。":
    "For the tmd-cli app: pair by scanning the code on the Devices tab; one approval lasts.",
  /* 外网风险门:拒绝后的非模态静态门 */
  "外网访问未启用": "Internet access not enabled",
  "首次使用前需先阅读并确认外网风险提示;确认前不展示中继配置。":
    "Read and accept the internet risk notice before first use; relay controls stay hidden until then.",
  "查看风险提示": "View the risk notice",
  /* 设置「安全」区:重看外网风险提示入口 */
  "安全": "Security",
  "外网风险提示": "Internet risk notice",
  "首次进入外网 tab 前的一次性风险确认只记在本机(不随中继同步)。点击下方按钮清除确认记录,外网 tab 将重新弹出风险提示。":
    "The one-time risk confirmation before entering the internet tabs is stored on this machine only (never synced over the relay). Click the button below to clear it — the internet tabs will show the risk notice again.",
  "当前状态": "Current status",
  "已确认": "Accepted",
  "未确认": "Not accepted",
  "重看外网风险提示": "Show the risk notice again",
  /* 一键部署卡标题(WebSelfHostCard,2026-10 i18n 收口) */
  "一键部署到自建服务器": "One-click deploy to your own server",
} as Record<string, string>;
