//! 范围闸门 —— 防误发超大/可疑范围的 PR(mossx range_gate 同口径复刻)。
//!
//! 判定顺序即安全性顺序:
//! 1. 空范围硬拦(upstream/<base>...HEAD 无改动 = 分支基线选错);
//! 2. 可疑根文件(readme/license 且总数 ≥32)硬拦 —— 即使已授权也拦,
//!    提示重查分支基线(典型事故:从错误基线fork 出的分支全量改写);
//! 3. ≤240 文件或授权(fingerprint 一致)放行;>240 未授权 → 要求确认,
//!    >300 额外标 diff 过大(GitHub 无法完整展示)。

use super::GitError;

pub(super) const PASS_MAX_CHANGED_FILES: usize = 240;
pub(super) const COMPLETE_DIFF_MAX_FILES: usize = 300;
const SUSPICIOUS_THRESHOLD: usize = 32;
/// 可疑根文件(归一化全路径精确匹配,仅根级命中)。
const SUSPICIOUS_PATHS: [&str; 3] = ["readme.md", "readme.zh-cn.md", "license"];

pub(super) enum Decision {
    Pass,
    /// 要求确认;reason 为人话说明,diff_incomplete 标 >300。
    ConfirmationRequired {
        changed_files: usize,
        reason: String,
        diff_incomplete: bool,
    },
}

/// git 输出路径归一化:去引号(git 对非 ASCII 路径加引号)。
fn normalize_path(path: &str) -> String {
    let s = path.trim();
    s.strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(s)
        .to_lowercase()
}

/// 范围闸门判定。`authorized` = 请求带 allowLargeRange 且
/// confirmedRangeFingerprint 与当前范围 fingerprint 完全一致(防确认后范围漂移)。
pub(super) fn evaluate(changed_paths: &[String], authorized: bool) -> Result<Decision, GitError> {
    if changed_paths.is_empty() {
        return Err(GitError::empty(
            "范围闸门拦截:upstream/<base>...HEAD 无改动文件,请检查分支基线",
        ));
    }
    let suspicious: Vec<String> = changed_paths
        .iter()
        .filter(|p| SUSPICIOUS_PATHS.contains(&normalize_path(p).as_str()))
        .cloned()
        .collect();
    if !suspicious.is_empty() && changed_paths.len() >= SUSPICIOUS_THRESHOLD {
        return Err(GitError::empty(format!(
            "范围闸门拦截:检出可疑根文件({})且改动达 {} 个,请重查分支基线后再创建 PR",
            suspicious.join(", "),
            changed_paths.len()
        )));
    }
    if changed_paths.len() <= PASS_MAX_CHANGED_FILES || authorized {
        return Ok(Decision::Pass);
    }
    let diff_incomplete = changed_paths.len() > COMPLETE_DIFF_MAX_FILES;
    let reason = if diff_incomplete {
        format!(
            "改动 {} 个文件,超过 GitHub 完整 diff 展示上限 {}。确认仍要创建 PR?",
            changed_paths.len(),
            COMPLETE_DIFF_MAX_FILES
        )
    } else {
        format!(
            "改动 {} 个文件,超过审查阈值 {}。确认仍要创建 PR?",
            changed_paths.len(),
            PASS_MAX_CHANGED_FILES
        )
    };
    Ok(Decision::ConfirmationRequired {
        changed_files: changed_paths.len(),
        reason,
        diff_incomplete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("src/file{i}.rs")).collect()
    }

    #[test]
    fn empty_range_hard_blocked() {
        assert!(evaluate(&[], false).is_err());
    }

    #[test]
    fn under_threshold_passes() {
        assert!(matches!(evaluate(&files(240), false), Ok(Decision::Pass)));
    }

    #[test]
    fn over_threshold_requires_confirmation() {
        let d = evaluate(&files(241), false).unwrap();
        match d {
            Decision::ConfirmationRequired {
                changed_files,
                diff_incomplete,
                ..
            } => {
                assert_eq!(changed_files, 241);
                assert!(!diff_incomplete);
            }
            _ => panic!("expected ConfirmationRequired"),
        }
        // >300 标 diff 不完整
        match evaluate(&files(301), false).unwrap() {
            Decision::ConfirmationRequired {
                diff_incomplete, ..
            } => assert!(diff_incomplete),
            _ => panic!("expected ConfirmationRequired"),
        }
    }

    #[test]
    fn authorization_with_matching_fingerprint_passes() {
        assert!(matches!(evaluate(&files(400), true), Ok(Decision::Pass)));
    }

    #[test]
    fn suspicious_root_files_hard_blocked_even_authorized() {
        let mut fs = files(40);
        fs.push("README.zh-CN.md".into());
        assert!(evaluate(&fs, true).is_err());
        // <32 文件时可疑文件不拦(小改动撞名属正常)
        let mut fs2 = files(10);
        fs2.push("LICENSE".into());
        assert!(matches!(evaluate(&fs2, false), Ok(Decision::Pass)));
    }
}
