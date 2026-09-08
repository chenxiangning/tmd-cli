//! path_cache 单测 —— 自主文件(文件规模铁则:主文件保 PATH 状态机本身)。
use super::*;

/* unix:冒号分隔 + 常见 unix 目录兜底 */
#[cfg(unix)]
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

/* windows:分号分隔 + %APPDATA%\npm 兜底,无重复 */
#[cfg(windows)]
#[test]
fn enriched_path_windows_含_appdata_npm_兜底且去重() {
    let path = enriched_path();
    let appdata_npm = std::env::var("APPDATA")
        .map(|a| format!("{a}\\npm"))
        .expect("APPDATA");
    assert!(
        path.split(';').any(|d| d == appdata_npm),
        "缺 {appdata_npm}: {path}"
    );
    let dirs: Vec<&str> = path.split(';').collect();
    let unique: std::collections::HashSet<_> = dirs.iter().collect();
    assert_eq!(dirs.len(), unique.len(), "PATH 有重复项: {path}");
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
