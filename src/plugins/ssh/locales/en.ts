/** ssh 插件自带 en 词典(原生弹窗清零轮新增词条;kernel/locales 不收纳单插件词条)。 */
export const MESSAGES_EN = {
  /* SFTP 树操作弹窗 */
  "新建目录": "New directory",
  "重命名": "Rename",
  /* 远端文件保存冲突确认 */
  "远端文件已变更": "Remote file has changed",
  "覆盖": "Overwrite",
  /* F-02 右栏「远程」落地页 */
  "远程": "Remote",
  "本机": "Local machine",
  "SSH 远程": "SSH remote",
  "还没有远程会话或 WSL 工作区": "No remote sessions or WSL workspaces yet",
  "SSH 连接在新建会话菜单的「远程来源」组;WSL 工作区经「添加工作区 → WSL 发行版」接入。":
    "SSH connects from the \"Remote sources\" group in the new-session menu; WSL workspaces are added via \"Add workspace → WSL distro\".",
  "打开 WSL 面板": "Open WSL panel",
  "未探测引擎;打开 WSL 面板点「连接」后可新建会话":
    "Engines not probed; open the WSL panel and hit \"Connect\" to start sessions",
  "未检出任何引擎": "No engines detected",
  "已探测 {n} 个引擎": "{n} engines probed",
  "网络代理:右缘 rail 底部簇的梯子图标统一管理(插件启用时),对 SSH 连接与 CLI 子进程同时生效。":
    "Network proxy: managed from the ladder icon in the right rail bottom cluster (when the plugin is enabled); applies to SSH connections and CLI child processes alike.",
} as Record<string, string>;
