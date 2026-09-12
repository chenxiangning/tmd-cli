//! installer 单测 —— 自主文件(文件规模铁则:主文件保安装执行器本身)。
use super::*;

#[test]
fn npm_command_pins_latest() {
    let plan = InstallPlan::Npm {
        package: "@qoder-ai/qodercli".into(),
    };
    let (program, args) = install_command(&plan, None);
    /* Windows 经 cmd /c 跑 npm.cmd shim,unix 直跑 npm */
    #[cfg(windows)]
    {
        assert_eq!(program, "cmd");
        assert_eq!(
            args,
            vec![
                "/c",
                "npm",
                "install",
                "-g",
                "@qoder-ai/qodercli@latest",
                "--allow-scripts=@qoder-ai/qodercli"
            ]
        );
    }
    #[cfg(not(windows))]
    {
        assert_eq!(program, "npm");
        assert_eq!(
            args,
            vec![
                "install",
                "-g",
                "@qoder-ai/qodercli@latest",
                "--allow-scripts=@qoder-ai/qodercli"
            ]
        );
    }
}

#[test]
fn script_command_uses_platform_entry() {
    let plan = InstallPlan::Script {
        unix: "curl -fsSL https://example.com/install.sh | bash".into(),
        windows: "irm https://example.com/install.ps1 | iex".into(),
    };
    let (_program, args) = install_command(&plan, None);
    #[cfg(not(windows))]
    assert_eq!(
        args,
        vec!["-c", "curl -fsSL https://example.com/install.sh | bash"]
    );
    #[cfg(windows)]
    assert!(args.contains(&"irm https://example.com/install.ps1 | iex".to_string()));
}

/// 前端传参是 camelCase tagged union:通道名/字段名漂移会 serde 拒绝,
/// 这里锁死 ipc.ts 侧的构造形状。
#[test]
fn plan_deserializes_frontend_shape() {
    let plan: InstallPlan =
        serde_json::from_str(r#"{"channel":"npm","package":"@openai/codex"}"#).unwrap();
    assert!(matches!(plan, InstallPlan::Npm { .. }));
    let plan: InstallPlan =
        serde_json::from_str(r#"{"channel":"script","unix":"u","windows":"w"}"#).unwrap();
    assert!(matches!(plan, InstallPlan::Script { .. }));
    let plan: InstallPlan = serde_json::from_str(
        r#"{"channel":"command","program":"omp","args":["plugin","install","pi-lens"]}"#,
    )
    .unwrap();
    assert!(matches!(plan, InstallPlan::Command { .. }));
}

/// command 通道原样透传前端参数;Windows 侧锁死 cmd /c 包装形状。
#[test]
fn command_channel_passes_through() {
    let plan = InstallPlan::Command {
        program: "omp".into(),
        args: vec!["plugin".into(), "uninstall".into(), "pi-lens".into()],
    };
    let (program, args) = install_command(&plan, None);
    #[cfg(not(windows))]
    {
        assert_eq!(program, "omp");
        assert_eq!(args, vec!["plugin", "uninstall", "pi-lens"]);
    }
    #[cfg(windows)]
    {
        assert_eq!(program, "cmd");
        assert_eq!(args, vec!["/c", "omp", "plugin", "uninstall", "pi-lens"]);
    }
}
