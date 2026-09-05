//! fs_edit.rs 的单元测试(文件规模铁则拆出;经 #[path] 挂回 fs_edit::tests)。

use super::*;

fn temp_root(tag: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("tmd-cli-fs-edit-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("创建临时目录失败");
    root
}

#[test]
fn write_file_覆写与新建空文件() {
    let root = temp_root("write");
    let file = root.join("a.txt");

    // 新建(父目录存在,内容为空)
    write_file(file.to_str().unwrap(), "").unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"");

    // 覆写
    write_file(file.to_str().unwrap(), "hello\n").unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"hello\n");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn write_file_拒绝相对路径_git_段_与目录目标() {
    let root = temp_root("guard");
    let git_dir = root.join(".git");
    fs::create_dir_all(&git_dir).unwrap();

    assert!(write_file("relative/path.txt", "x").is_err());
    assert!(write_file(git_dir.join("x").to_str().unwrap(), "x").is_err());
    assert!(write_file(root.to_str().unwrap(), "x").is_err());
    assert!(
        fs::read(git_dir.join("x")).is_err(),
        ".git 内文件不得被创建"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn create_file_新建成功且拒绝覆写已有内容() {
    let root = temp_root("cfile");
    let file = root.join("new.txt");

    create_file(file.to_str().unwrap()).unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"");

    // 已存在文件 → 报错且内容原封不动(绝不覆写)
    fs::write(&file, "keep").unwrap();
    let err = create_file(file.to_str().unwrap()).unwrap_err();
    assert!(err.contains("已存在"), "应报已存在: {err}");
    assert_eq!(fs::read(&file).unwrap(), b"keep");
    // 同名目录存在 → 也报错
    let dir = root.join("conflict");
    fs::create_dir_all(&dir).unwrap();
    assert!(create_file(dir.to_str().unwrap()).is_err());
    // 父目录缺失 → 报错而不是递归创建
    assert!(create_file(root.join("no-such-parent/child.txt").to_str().unwrap()).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn create_dir_新建成功且已存在报错() {
    let root = temp_root("mkdir");
    let dir = root.join("new-dir");

    create_dir(dir.to_str().unwrap()).unwrap();
    assert!(dir.is_dir());
    // 已存在目录 → 报错
    let err = create_dir(dir.to_str().unwrap()).unwrap_err();
    assert!(err.contains("已存在"), "应报已存在: {err}");
    // 同名文件存在 → 也报错
    let file = root.join("conflict");
    fs::write(&file, "x").unwrap();
    assert!(create_dir(file.to_str().unwrap()).is_err());
    // 父目录缺失 → 报错而不是递归创建
    assert!(create_dir(root.join("no-such-parent/child").to_str().unwrap()).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_entry_改名返回新路径且拒绝非法名与撞名() {
    let root = temp_root("rename");
    let file = root.join("old.txt");
    fs::write(&file, "data").unwrap();

    let new_path = rename_entry(file.to_str().unwrap(), "new.txt").unwrap();
    assert_eq!(new_path, root.join("new.txt").to_string_lossy().to_string());
    assert!(!file.exists());
    assert_eq!(fs::read(root.join("new.txt")).unwrap(), b"data");

    // 目标名撞已有文件
    fs::write(root.join("b.txt"), "b").unwrap();
    let err = rename_entry(root.join("new.txt").to_str().unwrap(), "b.txt").unwrap_err();
    assert!(err.contains("已存在"), "撞名应报已存在: {err}");

    // 非法文件名
    assert!(rename_entry(root.join("new.txt").to_str().unwrap(), "a/b").is_err());
    assert!(rename_entry(root.join("new.txt").to_str().unwrap(), "..").is_err());
    assert!(rename_entry(root.join("new.txt").to_str().unwrap(), "").is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn trash_entry_对缺失路径幂等且拒绝_git_段() {
    let root = temp_root("trash");
    // 不存在 → 幂等成功
    trash_entry(root.join("nope.txt").to_str().unwrap()).unwrap();
    // .git 段 → 拒绝(即使不存在)
    assert!(trash_entry(root.join(".git/x").to_str().unwrap()).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn reveal_拒绝不存在的路径() {
    let root = temp_root("reveal");
    assert!(reveal_in_file_manager(root.join("nope.txt").to_str().unwrap()).is_err());
    let _ = fs::remove_dir_all(&root);
}
