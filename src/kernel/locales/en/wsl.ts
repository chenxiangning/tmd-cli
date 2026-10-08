/** en 词典 · wsl 域(wsl 插件词条;自 misc 拆出,文件规模铁则)。 */
export const MESSAGES = {
  // WslCard(设默认失败行)
  "设默认失败:{reason}": "Failed to set default: {reason}",
  "超时": "timed out",
  // 插件注册(WorkspaceOrigin.addTab 卡片标题/描述)
  "WSL 发行版": "WSL distro",
  "经 \\\\wsl.localhost 或 SSH 远程宿主添加": "Add via a \\\\wsl.localhost UNC or an SSH remote host",
  // RemoteSection / AddWslTab / HostForm(探测与密码显隐)
  "必填": "Required",
  "1-65535": "1-65535",
  "探测中…": "Probing…",
  "正在探测发行版…": "Detecting distros…",
  "显示密码": "Show password",
  "隐藏密码": "Hide password",
  // WslDirBrowser(路径直达输入框)
  "粘贴绝对路径回车直达;输入前缀过滤目录":
  "Paste an absolute path and press Enter to jump; typing filters by prefix",
  "以 / 或 ~ 开头回车即跳该层;普通输入按目录名前缀过滤":
  "Start with / or ~ and press Enter to jump there; plain input filters directory names by prefix",
} as Record<string, string>;
