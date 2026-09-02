//! PATH 富化:login shell 两级提取 + 兜底目录合并 + 进程级缓存(降级可自愈)。
//!
//! 2026-09-02 前 LazyLock 永久缓存降级结果,打包版 omp/kimi 误报"未安装"
//! 且刷新键无法自愈 —— 本模块的状态机保证 Degraded 结果不永久缓存。

use parking_lot::Mutex;

use super::wait_child_with_timeout;

/// PATH 计算结果:合并后的 PATH + 提取质量标记。
struct ComputedPath {
    path: String,
    /// login shell 提取是否成功。false = 降级:缺 login shell 独有目录
    /// (如 ~/.hermes/node/bin),允许重试自愈,不得永久缓存。
    /// Windows 无 login shell 概念,恒 true。
    shell_ok: bool,
    /// 本次是否只用了快路径(-lc):true 时需后台补一次 -ilc 升级,
    /// 否则 .zshrc 独有目录(如 nvm 的 node bin)拿不到。仅 unix 使用。
    #[cfg_attr(not(unix), allow(dead_code))]
    needs_interactive_upgrade: bool,
}

/// PATH 缓存状态。Degraded 不永久缓存(2026-09-02 前 LazyLock 永久缓存
/// 降级结果,omp/kimi 误报"未安装"且刷新键无法自愈)。
enum PathState {
    Ready(String),
    Degraded(String),
}

#[derive(Default)]
struct PathCache {
    state: Option<PathState>,
    /// 后台线程(降级重试 / -ilc 升级)单飞标记,防并发 fork 多个 login shell。
    bg_in_flight: bool,
}

static PATH_CACHE: Mutex<PathCache> = Mutex::new(PathCache {
    state: None,
    bg_in_flight: false,
});

/// 合并后的 PATH:login shell(unix) > 进程环境 > 常见安装目录(去重,保序)。
/// 首次调用同步计算;降级时返回旧值并踢后台重试自愈,不阻塞调用方
/// (PTY spawn 等)。probe 等用户刷新路径用 enriched_path_refresh()。
pub(crate) fn enriched_path() -> String {
    cache_get_or_refresh(&mut PATH_CACHE.lock(), false, compute_enriched_path)
}

/// 降级状态下同步重算(用户点刷新立即可愈),Ready 时零开销。
/// 持锁重算即单飞;并发调用方最坏阻塞 2s+5s,仅降级自愈瞬间发生。
pub(crate) fn enriched_path_refresh() -> String {
    cache_get_or_refresh(&mut PATH_CACHE.lock(), true, compute_enriched_path)
}

/// 缓存状态机(同步部分;compute 可注入,便于单测):
/// Ready → 直接返回;Degraded + 非 refresh → 返回旧值并踢后台重试;
/// 其余(冷启动 / Degraded + refresh)→ 同步重算入库。
fn cache_get_or_refresh(
    cache: &mut PathCache,
    refresh: bool,
    compute: impl FnOnce() -> ComputedPath,
) -> String {
    match &cache.state {
        Some(PathState::Ready(p)) => p.clone(),
        Some(PathState::Degraded(p)) if !refresh => {
            let stale = p.clone();
            kick_background_recompute(cache);
            stale
        }
        _ => compute_and_store(cache, compute),
    }
}

fn compute_and_store(cache: &mut PathCache, compute: impl FnOnce() -> ComputedPath) -> String {
    let computed = compute();
    let path = computed.path.clone();
    /* 先入库再踢升级:-ilc 升级线程可能先完成,后入库会被快路径旧值覆写 */
    cache.state = Some(if computed.shell_ok {
        PathState::Ready(computed.path)
    } else {
        PathState::Degraded(computed.path)
    });
    #[cfg(unix)]
    if computed.shell_ok && computed.needs_interactive_upgrade {
        kick_interactive_upgrade(cache);
    }
    path
}

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

fn build_enriched_path(login_shell: Option<&str>) -> String {
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

/// login shell 快路径(-lc)超时(秒):只读 .zshenv/.zprofile(不读 .zshrc),
/// 典型 <0.1s,重 rc 机器也撞不到上限。
#[cfg(unix)]
const LOGIN_SHELL_FAST_TIMEOUT_SECS: u64 = 2;
/// login shell 交互路径(-ilc)超时(秒):读 .zshrc,nvm/pyenv/代理检测类重 rc
/// 秒级起步(实测热缓存 ~2s);rc 里有交互/阻塞读取则永久挂住 —— 必须硬超时。
#[cfg(unix)]
const LOGIN_SHELL_INTERACTIVE_TIMEOUT_SECS: u64 = 5;

/// 从用户 login shell 提取 PATH。哨兵包裹输出,免疫用户 rc 文件的噪音打印。
/// mode:"-lc"(快路径,不读 .zshrc)或 "-ilc"(完整路径);超时 kill 返回 None。
/// 仅 unix:Windows 无 login shell 概念,GUI 进程已继承注册表合并 PATH。
#[cfg(unix)]
fn extract_path_from_shell(mode: &str, timeout_secs: u64) -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    const BEGIN: &str = "__TMD_PATH_BEGIN__";
    const END: &str = "__TMD_PATH_END__";
    let mut child = std::process::Command::new(shell)
        .arg(mode)
        .arg(format!(
            "echo {BEGIN}; printf '%s' \"$PATH\"; echo; echo {END}"
        ))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;

    /* rc 文件 fork 的守护进程(ssh-agent 等)会继承管道写端:wait 之后再
     * read-to-EOF 永不返回。必须在 spawn 后立刻并发排空两个管道,
     * 退出后用带超时的 channel 收 stdout,超时即放弃(防挂死)。 */
    use std::io::Read;
    let mut stdout_pipe = child.stdout.take()?;
    let mut stderr_pipe = child.stderr.take()?;
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        let _ = tx.send(buf);
        /* buf 随线程消亡;stderr 同法排空(内容不关心,只为防子进程写阻塞) */
    });
    std::thread::spawn(move || {
        let mut sink = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut sink);
    });

    let exit = wait_child_with_timeout(&mut child, std::time::Duration::from_secs(timeout_secs))?;
    if !exit.ok()?.success() {
        return None;
    }
    let out = rx.recv_timeout(std::time::Duration::from_secs(1)).ok()?;
    let text = String::from_utf8_lossy(&out);
    let path = text
        .split_once(BEGIN)?
        .1
        .split_once(END)?
        .0
        .trim()
        .to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// 计算一次富化 PATH(unix 两级提取;Windows 进程 PATH + 兜底目录)。
#[cfg(unix)]
fn compute_enriched_path() -> ComputedPath {
    /* 快路径 -lc:只读 .zshenv/.zprofile,典型 <0.1s。成功但可能缺 .zshrc
     * 独有目录(如 nvm 的 node bin)→ 标记 needs_interactive_upgrade,
     * 由调用方后台补一次 -ilc 升级。 */
    if let Some(fast) = extract_path_from_shell("-lc", LOGIN_SHELL_FAST_TIMEOUT_SECS) {
        return ComputedPath {
            path: build_enriched_path(Some(&fast)),
            shell_ok: true,
            needs_interactive_upgrade: true,
        };
    }
    /* 完整路径 -ilc:读 .zshrc,nvm/pyenv/代理检测类重 rc 秒级起步 */
    if let Some(full) = extract_path_from_shell("-ilc", LOGIN_SHELL_INTERACTIVE_TIMEOUT_SECS) {
        return ComputedPath {
            path: build_enriched_path(Some(&full)),
            shell_ok: true,
            needs_interactive_upgrade: false,
        };
    }
    /* 两级全失败(超时/挂住/$SHELL 不支持 -l):降级为进程 PATH + 兜底目录 */
    ComputedPath {
        path: build_enriched_path(None),
        shell_ok: false,
        needs_interactive_upgrade: false,
    }
}

/// Windows:GUI 进程继承注册表合并 PATH,+ 兜底目录即最终结果;
/// 无 login shell 提取,无降级/重试概念(shell_ok 恒 true)。
#[cfg(not(unix))]
fn compute_enriched_path() -> ComputedPath {
    ComputedPath {
        path: build_enriched_path(None),
        shell_ok: true,
        needs_interactive_upgrade: false,
    }
}

/// 降级自愈:后台重算 PATH(单飞,bg_in_flight 防并发 fork 多个 login
/// shell)。快路径恢复的同线程补完 -ilc 再入库;仍失败保持旧降级值,
/// 下次访问再试。非 unix 无降级概念,为空操作。
fn kick_background_recompute(cache: &mut PathCache) {
    #[cfg(unix)]
    {
        if cache.bg_in_flight {
            return;
        }
        cache.bg_in_flight = true;
        std::thread::spawn(|| {
            let mut computed = compute_enriched_path();
            if computed.shell_ok && computed.needs_interactive_upgrade {
                if let Some(full) =
                    extract_path_from_shell("-ilc", LOGIN_SHELL_INTERACTIVE_TIMEOUT_SECS)
                {
                    computed.path = build_enriched_path(Some(&full));
                }
            }
            let mut cache = PATH_CACHE.lock();
            cache.bg_in_flight = false;
            if computed.shell_ok {
                cache.state = Some(PathState::Ready(computed.path));
            }
        });
    }
    #[cfg(not(unix))]
    let _ = cache;
}

/// 快路径(-lc)成功后后台补一次 -ilc 升级,把 .zshrc 独有目录合入缓存。
/// 单飞;升级失败保持快路径结果,无害。仅 unix 有意义。
#[cfg(unix)]
fn kick_interactive_upgrade(cache: &mut PathCache) {
    if cache.bg_in_flight {
        return;
    }
    cache.bg_in_flight = true;
    std::thread::spawn(|| {
        let upgrade = extract_path_from_shell("-ilc", LOGIN_SHELL_INTERACTIVE_TIMEOUT_SECS);
        let mut cache = PATH_CACHE.lock();
        cache.bg_in_flight = false;
        if let Some(login) = upgrade {
            cache.state = Some(PathState::Ready(build_enriched_path(Some(&login))));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enriched_path_包含进程_path_与常见安装目录且去重() {
        let path = enriched_path();
        for dir in ["/usr/bin", "/bin"] {
            assert!(path.split(':').any(|d| d == dir), "缺 {dir}: {path}");
        }
        let dirs: Vec<&str> = path.split(':').collect();
        let unique: std::collections::HashSet<_> = dirs.iter().collect();
        assert_eq!(dirs.len(), unique.len(), "PATH 有重复项: {path}");
    }

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

    #[test]
    fn 缓存_ready_后不再重算() {
        let mut cache = PathCache::default();
        let p1 = cache_get_or_refresh(&mut cache, false, || ComputedPath {
            path: "full".into(),
            shell_ok: true,
            needs_interactive_upgrade: false,
        });
        assert_eq!(p1, "full");
        let p2 = cache_get_or_refresh(&mut cache, true, || panic!("Ready 不应重算"));
        assert_eq!(p2, "full");
    }

    #[test]
    fn 缓存降级结果_refresh_时同步重算自愈() {
        /* 回归守卫:2026-09-02 前 LazyLock 永久缓存降级 PATH,omp/kimi
         * 误报"未安装"且刷新键无法自愈。 */
        let mut cache = PathCache::default();
        let p1 = cache_get_or_refresh(&mut cache, true, || ComputedPath {
            path: "fallback-only".into(),
            shell_ok: false,
            needs_interactive_upgrade: false,
        });
        assert_eq!(p1, "fallback-only");
        assert!(matches!(cache.state, Some(PathState::Degraded(_))));
        /* shell 恢复后 refresh 同步重算 → Ready */
        let p2 = cache_get_or_refresh(&mut cache, true, || ComputedPath {
            path: "full".into(),
            shell_ok: true,
            needs_interactive_upgrade: false,
        });
        assert_eq!(p2, "full");
        assert!(matches!(cache.state, Some(PathState::Ready(_))));
    }
}
