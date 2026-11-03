//! 已安装包版本回读 —— CLI 的 `--version` 被运行时门槛拦截时的探针兜底。
//! 仅认 node_modules 内的真实安装包,不猜版本、不绕过 CLI 自身运行检查。

use std::path::Component;

/// 从 symlink 真身所在的 node_modules 安装包读取 package.json#version。
///
/// 典型布局:`~/.bun/bin/omp -> .../node_modules/@scope/pkg/dist/cli.js`。
/// 非 node_modules 布局、悬空链接、缺清单或版本字段均返回 None。
pub(crate) fn linked_package_version(hit: &str) -> Option<String> {
    let real = std::fs::canonicalize(hit).ok()?;
    if !real
        .components()
        .any(|part| matches!(part, Component::Normal(name) if name == "node_modules"))
    {
        return None;
    }

    for dir in real.parent()?.ancestors().take(8) {
        if dir.file_name()? == "node_modules" {
            return None;
        }
        let manifest = dir.join("package.json");
        if !manifest.is_file() {
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(manifest).ok()?).ok()?;
        let version = value.get("version")?.as_str()?.trim();
        return (!version.is_empty()).then(|| version.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("tmd-probe-pkg-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn reads_version_from_linked_node_package() {
        let root = temp_root("linked");
        let package = root.join("global/node_modules/@oh-my-pi/pi-coding-agent");
        let dist = package.join("dist");
        std::fs::create_dir_all(&dist).unwrap();
        let cli = dist.join("cli.js");
        std::fs::write(&cli, "").unwrap();
        std::fs::write(package.join("package.json"), r#"{"version":"18.16.0"}"#).unwrap();

        assert_eq!(
            linked_package_version(cli.to_str().unwrap()).as_deref(),
            Some("18.16.0")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn follows_relative_symlink_to_package() {
        let root = temp_root("symlink");
        let package = root.join("install/global/node_modules/@scope/pkg");
        std::fs::create_dir_all(package.join("dist")).unwrap();
        let cli = package.join("dist/cli.js");
        std::fs::write(&cli, "").unwrap();
        std::fs::write(package.join("package.json"), r#"{"version":"1.2.3"}"#).unwrap();
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let link = bin.join("omp");
        std::os::unix::fs::symlink(
            "../install/global/node_modules/@scope/pkg/dist/cli.js",
            &link,
        )
        .unwrap();

        assert_eq!(
            linked_package_version(link.to_str().unwrap()).as_deref(),
            Some("1.2.3")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_non_node_package_and_missing_version() {
        let root = temp_root("reject");
        let plain = root.join("plain/dist");
        std::fs::create_dir_all(&plain).unwrap();
        let native = plain.join("cli");
        std::fs::write(&native, "").unwrap();
        std::fs::write(plain.join("package.json"), r#"{"version":"9.9.9"}"#).unwrap();
        assert_eq!(linked_package_version(native.to_str().unwrap()), None);

        let package = root.join("node_modules/pkg");
        std::fs::create_dir_all(&package).unwrap();
        let cli = package.join("cli.js");
        std::fs::write(&cli, "").unwrap();
        std::fs::write(package.join("package.json"), r#"{"name":"pkg"}"#).unwrap();
        assert_eq!(linked_package_version(cli.to_str().unwrap()), None);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn missing_file_returns_none() {
        assert_eq!(linked_package_version("/definitely/missing/tmd-cli"), None);
        assert_eq!(linked_package_version(""), None);
    }
}
