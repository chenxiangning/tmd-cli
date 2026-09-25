//! npm 全局布局识别 —— 双副本遮蔽"就地更新"的判据。
//! 探针(probe.rs)与安装器(installer.rs npm 通道 --prefix)共用;
//! 从 probe.rs 拆出(300 行铁则),语义见各函数文档。

/// npm 全局布局识别(symlink 跟链入口):命中副本位于某 npm prefix 内
/// → 返回该 prefix。
pub(crate) fn npm_prefix_of(hit: &str) -> Option<String> {
    /* symlink 间接层(~/.local/bin/pi → ~/.hermes/node/bin/pi,2026-09-25
     * 本机实证 pi 更新不同步):PATH 首位命中可能是非 npm 目录里的链接。
     * 逐级跟链,每级先判 npm 布局,命中即停;真身不在 npm 布局(官方原生
     * 副本)或链接成环 → None。 */
    let mut cur = std::path::PathBuf::from(hit);
    for _ in 0..16 {
        if let Some(prefix) = npm_layout_prefix(&cur) {
            return Some(prefix);
        }
        let target = std::fs::read_link(&cur).ok()?;
        cur = if target.is_absolute() {
            target
        } else {
            cur.parent()?.join(target)
        };
    }
    None
}

/// 单级 npm 全局布局判定:命中文件落在某 npm prefix 内 → 返回该 prefix。
/// - unix:`<X>/bin/<binary>` 且 `<X>/lib/node_modules` 存在;
/// - Windows:npm 全局 shim 直接落在 prefix 根(无 bin 段,如
///   `%APPDATA%\npm\omp.cmd`),故 prefix = 命中文件父目录,且
///   `<X>\node_modules` 存在。官方原生副本(如 .kimi-code\bin)无
///   node_modules → None,不会被误判为 npm 管理。
fn npm_layout_prefix(hit: &std::path::Path) -> Option<String> {
    let dir = hit.parent()?;
    #[cfg(unix)]
    {
        if dir.file_name()?.to_str()? != "bin" {
            return None;
        }
        let prefix = dir.parent()?.to_str()?.to_string();
        std::path::Path::new(&prefix)
            .join("lib/node_modules")
            .is_dir()
            .then_some(prefix)
    }
    #[cfg(not(unix))]
    {
        let prefix = dir.to_str()?.to_string();
        dir.join("node_modules").is_dir().then_some(prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npm_prefix_of_matches_platform_global_layout() {
        let root = std::env::temp_dir().join(format!("tmd-probe-np-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        /* 双平台各自的真实 npm 全局布局:unix <X>/bin/<bin> + lib/node_modules,
         * Windows <X>\<bin> + node_modules(shim 与包同层,无 bin 段)。 */
        #[cfg(unix)]
        let (bin_dir, modules_rel) = (root.join("np/bin"), "np/lib/node_modules");
        #[cfg(not(unix))]
        let (bin_dir, modules_rel) = (root.join("np"), "np/node_modules");
        std::fs::create_dir_all(&bin_dir).unwrap();
        std::fs::create_dir_all(root.join(modules_rel)).unwrap();
        let hit = bin_dir.join("omp");
        std::fs::write(&hit, "").unwrap();
        assert_eq!(
            npm_prefix_of(hit.to_str().unwrap()).as_deref(),
            Some(root.join("np").to_str().unwrap()),
            "npm 全局布局内的副本应识别出 prefix"
        );

        /* 非 npm 布局(无 node_modules,如官方原生副本 .kimi-code\bin)→ None。 */
        let bare = root.join("plain");
        std::fs::create_dir_all(&bare).unwrap();
        let native = bare.join("kimi.exe");
        std::fs::write(&native, "").unwrap();
        assert_eq!(npm_prefix_of(native.to_str().unwrap()), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn npm_prefix_of_resolves_symlink_indirection() {
        /* PATH 首位是非 npm 目录里的 symlink(如 ~/.local/bin/pi →
         * ~/.hermes/node/bin/pi)时,须跟链识别出真身所属 npm prefix,
         * 否则安装器丢 --prefix、更新写进默认 prefix 副本(2026-09-25)。 */
        let root = std::env::temp_dir().join(format!("tmd-probe-sym-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let real = root.join("np/bin/pi");
        std::fs::create_dir_all(real.parent().unwrap()).unwrap();
        std::fs::create_dir_all(root.join("np/lib/node_modules")).unwrap();
        std::fs::write(&real, "").unwrap();
        let link_dir = root.join("local/bin");
        std::fs::create_dir_all(&link_dir).unwrap();

        /* 绝对 target。 */
        let abs_link = link_dir.join("pi");
        std::os::unix::fs::symlink(&real, &abs_link).unwrap();
        assert_eq!(
            npm_prefix_of(abs_link.to_str().unwrap()).as_deref(),
            Some(root.join("np").to_str().unwrap()),
            "symlink 间接层应跟链到真身所属 npm prefix"
        );

        /* 相对 target(npm bin shim 常见形态 ../lib/...)。prefix 里会带
         * 未归一的 .. 分量(open/npm 均按真实目录解析),按 canonicalize 比目录。 */
        let rel_link = link_dir.join("pi-rel");
        std::os::unix::fs::symlink("../../np/bin/pi", &rel_link).unwrap();
        let got = npm_prefix_of(rel_link.to_str().unwrap()).unwrap();
        assert_eq!(
            std::fs::canonicalize(got).unwrap(),
            root.join("np").canonicalize().unwrap(),
            "相对 target 的 symlink 同样应跟链识别"
        );

        /* 悬空链接 / 真身不在 npm 布局 → None。 */
        let dangling = link_dir.join("pi-dangling");
        std::os::unix::fs::symlink(root.join("nope/bin/pi"), &dangling).unwrap();
        assert_eq!(npm_prefix_of(dangling.to_str().unwrap()), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn npm_prefix_of_rejects_non_path_input() {
        /* 无父目录/不可表达路径不 panic(探针侧纯函数,输入来自磁盘枚举)。 */
        assert_eq!(npm_prefix_of(""), None);
    }
}
