/**
 * 文件详情页动作的命令桥 —— 内核快捷键(files.revealToTree / files.showFileHistory /
 * files.toggleGitBlame)经此触发当前激活文件详情页的动作。
 * FileTabBody 挂载期写入、卸载期清空(shortcuts.ts 的 shellBarToggles 同款先例)。
 */

/** 当前激活的文件详情(远程文件 remote=true,Git 类动作自守卫跳过)。 */
export const fileDetailActions: { current: { path: string; remote: boolean } | null } = {
  current: null,
};

/** blame 内嵌开关(仅本地编辑态有值);见 useFileBlame。 */
export const blameToggleRef: { current: (() => void) | null } = { current: null };
