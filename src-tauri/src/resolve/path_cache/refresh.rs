//! 探针 PATH 稳定快照 —— 首探同步等完整 shell PATH,后续探针复用。
//! 普通 PTY 仍走 path_cache 的快速 PATH + 后台升级,不在启动关键路径等待。

use super::*;

/// 降级状态下同步重算(用户点刷新立即可愈),Ready 时零开销。
/// 首次探针若只见快速 PATH,先同步升级完整 PATH,避免同屏引擎与依赖
/// 分别落在后台升级两侧,读到不同 Bun / Node 副本。
pub(crate) fn enriched_path_refresh() -> String {
    cache_get_probe_path(
        &mut PATH_CACHE.lock(),
        compute_probe_path,
        compute_enriched_path,
    )
}

/// 可注入计算器的探针状态机:首次稳定计算,后续走既有 Ready/Degraded 缓存。
fn cache_get_probe_path(
    cache: &mut PathCache,
    stable: impl FnOnce() -> ComputedPath,
    refresh: impl FnOnce() -> ComputedPath,
) -> String {
    if !cache.interactive_ready {
        let path = compute_and_store(cache, stable);
        /* 完整 shell 失败时 stable 已给出不再后台切换的快照;本次探针组
         * 仍必须共用该快照。Degraded 后续 refresh 保留既有自愈入口。 */
        cache.interactive_ready = true;
        return path;
    }
    cache_get_or_refresh(cache, true, refresh)
}

/// 探针首取:完整 -ilc 优先;-ilc 失败才退快速 -lc,且不再后台换 PATH。
#[cfg(unix)]
fn compute_probe_path() -> ComputedPath {
    if let Some(full) = extract_path_from_shell("-ilc", LOGIN_SHELL_INTERACTIVE_TIMEOUT_SECS) {
        return ComputedPath {
            path: build_enriched_path(Some(&full)),
            shell_ok: true,
            needs_interactive_upgrade: false,
        };
    }
    if let Some(fast) = extract_path_from_shell("-lc", LOGIN_SHELL_FAST_TIMEOUT_SECS) {
        return ComputedPath {
            path: build_enriched_path(Some(&fast)),
            shell_ok: true,
            needs_interactive_upgrade: false,
        };
    }
    ComputedPath {
        path: build_enriched_path(None),
        shell_ok: false,
        needs_interactive_upgrade: false,
    }
}

#[cfg(not(unix))]
fn compute_probe_path() -> ComputedPath {
    compute_enriched_path()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready(path: &str) -> ComputedPath {
        ComputedPath {
            path: path.into(),
            shell_ok: true,
            needs_interactive_upgrade: false,
        }
    }

    #[test]
    fn 首探把快速_path_升级为稳定快照_后续不重算() {
        let mut cache = PathCache {
            state: Some(PathState::Ready("fast-homebrew-bun".into())),
            interactive_ready: false,
            bg_in_flight: false,
        };
        let first = cache_get_probe_path(
            &mut cache,
            || ready("full-official-bun"),
            || panic!("首探不得走普通快速刷新"),
        );
        assert_eq!(first, "full-official-bun");
        assert!(cache.interactive_ready);

        let second = cache_get_probe_path(
            &mut cache,
            || panic!("稳定后不得再换 PATH"),
            || panic!("Ready 不得重算"),
        );
        assert_eq!(second, "full-official-bun");
    }

    #[test]
    fn 完整快照失败后的降级结果仍可刷新自愈() {
        let mut cache = PathCache::default();
        let first = cache_get_probe_path(
            &mut cache,
            || ComputedPath {
                path: "fallback".into(),
                shell_ok: false,
                needs_interactive_upgrade: false,
            },
            || panic!("首探只算一次"),
        );
        assert_eq!(first, "fallback");
        let second = cache_get_probe_path(
            &mut cache,
            || panic!("已有快照不得重取"),
            || ready("recovered"),
        );
        assert_eq!(second, "recovered");
    }
}
