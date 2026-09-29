//! skill_pkg 单测(fixtures 用 ZipWriter 现场造,Stored 方法不依赖压缩后端)。
//! 与实现分离是 300 行铁则(plugins_tests.rs 同款 #[path] 先例)。

use super::*;
use zip::write::SimpleFileOptions;

fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("tmd-skill-pkg-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 造一个 zip:entries = (name, bytes);目录条目以名尾 `/` 传入。
fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    for (name, bytes) in entries {
        if name.ends_with('/') {
            zip.add_directory(name.to_string(), SimpleFileOptions::default())
                .unwrap();
        } else {
            zip.start_file(name.to_string(), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
    }
    zip.finish().unwrap();
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

#[test]
fn 平铺包_clawhub_形状_strip_top_不剥() {
    let root = temp_root("flat");
    let zip_path = root.join("pkg.zip");
    make_zip(
        &zip_path,
        &[
            ("SKILL.md", b"---\nname: pdf\n---\nbody"),
            ("_meta.json", b"{}"),
        ],
    );
    let dest = root.join("out");
    let out = extract_zip(zip_path.to_str().unwrap(), dest.to_str().unwrap(), true).unwrap();
    assert_eq!(out.entries, 2);
    assert_eq!(read(&dest.join("SKILL.md")), "---\nname: pdf\n---\nbody");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 单顶层目录包_strip_top_剥离() {
    let root = temp_root("striptop");
    let zip_path = root.join("pkg.zip");
    make_zip(
        &zip_path,
        &[
            ("webapp/", b""),
            ("webapp/SKILL.md", b"hello"),
            ("webapp/scripts/run.sh", b"#!/bin/sh"),
        ],
    );
    let dest = root.join("out");
    let out = extract_zip(zip_path.to_str().unwrap(), dest.to_str().unwrap(), true).unwrap();
    assert_eq!(out.entries, 2);
    assert_eq!(read(&dest.join("SKILL.md")), "hello");
    assert_eq!(read(&dest.join("scripts/run.sh")), "#!/bin/sh");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn zip_slip_与绝对路径与反斜杠全拒绝() {
    let root = temp_root("slip");
    let dest = root.join("out");
    for (tag, name) in [
        ("parent", "../evil.txt"),
        ("abs", "/etc/evil"),
        ("backslash", "a\\b.txt"),
    ] {
        let zip_path = root.join(format!("{tag}.zip"));
        make_zip(&zip_path, &[(name, b"x")]);
        let err =
            extract_zip(zip_path.to_str().unwrap(), dest.to_str().unwrap(), false).unwrap_err();
        assert!(!err.is_empty(), "{tag} 应被拒绝");
        assert!(
            !dest.join("evil.txt").exists() && !root.join("evil.txt").exists(),
            "{tag} 不应落盘任何文件"
        );
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn symlink_模式位检测() {
    /* ZipWriter 写不出 symlink 类型位(写侧把 mode 钳成常规文件,
    实测 roundtrip 100644),写侧 fixture 无法造此形态;真恶意包
    external attributes 携带 0o120xxx,按位判。 */
    assert!(unix_mode_is_symlink(Some(0o120644)));
    assert!(unix_mode_is_symlink(Some(0o120777)));
    assert!(!unix_mode_is_symlink(Some(0o100644)));
    assert!(!unix_mode_is_symlink(Some(0o040755)));
    assert!(!unix_mode_is_symlink(None));
}

#[test]
fn 总大小超_10mb_拒绝() {
    let root = temp_root("size");
    let zip_path = root.join("pkg.zip");
    {
        /* 声明大小即可触发第一遍闸:写一个 11MB 声明的条目,内容用小实体
        (Stored 方法写不动 11MB 实体也行,但直接写 11MB 零块最省心)。 */
        let file = fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("big.bin", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&vec![0u8; (MAX_TOTAL_BYTES + 1) as usize])
            .unwrap();
        zip.finish().unwrap();
    }
    let err = extract_zip(
        zip_path.to_str().unwrap(),
        root.join("out").to_str().unwrap(),
        false,
    )
    .unwrap_err();
    assert!(err.contains("10MB"), "得: {err}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn macos_垃圾段跳过() {
    let root = temp_root("junk");
    let zip_path = root.join("pkg.zip");
    make_zip(
        &zip_path,
        &[
            ("SKILL.md", b"ok"),
            ("__MACOSX/SKILL.md", b"junk"),
            ("._SKILL.md", b"junk"),
        ],
    );
    let dest = root.join("out");
    let out = extract_zip(zip_path.to_str().unwrap(), dest.to_str().unwrap(), true).unwrap();
    assert_eq!(out.entries, 1);
    assert_eq!(read(&dest.join("SKILL.md")), "ok");
    assert!(!dest.join("__MACOSX").exists());
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn 建链_与_链接已存在报错() {
    let root = temp_root("link");
    let target = root.join("t");
    fs::create_dir_all(&target).unwrap();
    let link = root.join("l");
    let target_str = target.to_string_lossy().into_owned();
    let link_str = link.to_string_lossy().into_owned();
    create_skill_symlink(&target_str, &link_str).unwrap();
    assert!(link.is_dir(), "链接应可当目录用");
    assert_eq!(
        create_skill_symlink(&target_str, &link_str).unwrap_err(),
        "链接路径已存在"
    );
    let _ = fs::remove_dir_all(&root);
}
