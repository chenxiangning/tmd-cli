//! PATH 目录合并 —— login shell 输出 + 进程 PATH + 常见安装目录(去重保序)。
//! 自 path_cache.rs 拆出(文件规模铁则):纯函数,缓存状态机留在 path_cache.rs。

fn push_unique_dirs(dirs: &mut Vec<std::path::PathBuf>, value: &std::ffi::OsStr) {
    for dir in std::env::split_paths(value) {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
}

fn push_unique_dir(dirs: &mut Vec<std::path::PathBuf>, dir: std::path::PathBuf) {
    if !dirs.contains(&dir) {
        dirs.push(dir);
    }
}

pub(crate) fn build_enriched_path(login_shell: Option<&str>) -> String {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(login) = login_shell {
        push_unique_dirs(&mut dirs, std::ffi::OsStr::new(login));
    }
    if let Some(current) = std::env::var_os("PATH") {
        push_unique_dirs(&mut dirs, &current);
    }
    /* 家目录 bin:unix 用 HOME,Windows 用 USERPROFILE */
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home {
        push_unique_dir(
            &mut dirs,
            std::path::Path::new(&home).join(".local").join("bin"),
        );
        /* xai 官方 install.sh 固定装 ~/.grok/bin —— login shell 超时丢目录时兜底 */
        push_unique_dir(
            &mut dirs,
            std::path::Path::new(&home).join(".grok").join("bin"),
        );
        /* bun 官方脚本固定装 ~/.bun/bin(unix/Windows 同根)—— 装完 bun 不重启
         * 应用时本进程 PATH 不含此目录,探针与 `bun install -g` 子进程都靠此兜底 */
        push_unique_dir(
            &mut dirs,
            std::path::Path::new(&home).join(".bun").join("bin"),
        );
        /* hermes npm 全局 prefix:omp/kimi 等 CLI 引擎只落这里(~/.local/bin 无符号链接),
         * login shell 3s 超时时丢此目录 = omp/kimi 误报未安装(2026-09-02 实证) */
        push_unique_dir(
            &mut dirs,
            std::path::Path::new(&home)
                .join(".hermes")
                .join("node")
                .join("bin"),
        );
    }
    #[cfg(target_os = "macos")]
    push_unique_dirs(
        &mut dirs,
        std::ffi::OsStr::new("/opt/homebrew/bin:/usr/local/bin"),
    );
    #[cfg(target_os = "linux")]
    push_unique_dirs(&mut dirs, std::ffi::OsStr::new("/usr/local/bin:/snap/bin"));
    #[cfg(windows)]
    {
        /* npm 全局目录通常在注册表 PATH 里,补一道兜底 */
        if let Some(appdata) = std::env::var_os("APPDATA") {
            push_unique_dir(&mut dirs, std::path::Path::new(&appdata).join("npm"));
        }
    }
    std::env::join_paths(dirs)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_enriched_path_包含_hermes_node_bin_兜底() {
        /* 回归守卫(2026-09-02 omp/kimi 误报"未安装"):omp/kimi 只存在于
         * ~/.hermes/node/bin,login shell 超时丢目录时兜底必须覆盖。 */
        let path = build_enriched_path(None);
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .expect("HOME/USERPROFILE 未设置");
        let hermes = std::path::Path::new(&home)
            .join(".hermes")
            .join("node")
            .join("bin");
        let sep = if cfg!(windows) { ';' } else { ':' };
        assert!(
            path.split(sep).any(|d| d == hermes.to_string_lossy()),
            "缺 hermes 兜底目录: {path}"
        );
        /* 回归守卫(omp 前置依赖 bun):bun 官方脚本装 ~/.bun/bin,装完不重启
         * 应用时本进程 PATH 不含它,探针与安装子进程都靠此兜底。 */
        let bun_bin = std::path::Path::new(&home).join(".bun").join("bin");
        assert!(
            path.split(sep).any(|d| d == bun_bin.to_string_lossy()),
            "缺 .bun/bin 兜底目录: {path}"
        );
    }

    #[test]
    fn build_enriched_path_login_shell_目录排最前() {
        let path = build_enriched_path(Some("/tmp/tmd-cli-test-login-only-bin"));
        let sep = if cfg!(windows) { ';' } else { ':' };
        assert_eq!(
            path.split(sep).next().unwrap(),
            "/tmp/tmd-cli-test-login-only-bin"
        );
    }
}
