//! 账本契约类型 —— 自 mod.rs 拆出(文件规模铁则);字段语义注释随型迁移,
//! mod.rs 经 pub use 保持 super:: 引用契约不变。

use serde::{Deserialize, Serialize};

/// 单文件快照上限:超过则跳过存内容,只记状态(副本完整性 tradeoff:
/// 覆盖常规源码/配置,避免巨型产物撑爆 sidecar;skip 语义在 UI 显式可见)。
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// anchor 时刻(或 guard 时刻)的单文件记录。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SnapFile {
    /// 相对用户仓库 root 的路径(lossy UTF-8,与 git 模块同惯例)
    pub path: String,
    /// 工作区内容在 sidecar 的 blob hex;"" = 未存(existed=false 或 skip)
    pub oid: String,
    /// git 侧(index)内容 blob hex(用户仓库对象);"" = untracked 无基线。
    /// 前像兜底:恢复/求 diff 时 oid 为空则落到此处。
    #[serde(default)]
    pub base_oid: String,
    /// 快照时刻工作区是否存在该文件(false = 已删;恢复到此快照 = 删除)
    pub existed: bool,
    pub bytes: u64,
    /// 跳过存内容的原因(symlink / 过大 / 冲突 / 读失败)
    #[serde(default)]
    pub skip: Option<String>,
    /// 快照时刻的 git 展示状态符(A/M/D/R/T/C/?)
    pub status: String,
}

/// turn 封口条目里的单文件变更记录 —— 账本的核心:前后像 + diff 固化。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TurnFile {
    pub path: String,
    /// A(轮内新建)| D(轮内删除)| M
    pub status: String,
    /// 批前像 blob(sidecar);"" = 批前无内容(新建)
    pub before_oid: String,
    /// 批后像 blob(sidecar);"" = 批后无内容(删除)或内容不可知(skip)
    pub after_oid: String,
    pub existed_before: bool,
    pub existed_after: bool,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    /// unified diff 文本(封口瞬间固化);binary 为空串
    #[serde(default)]
    pub patch: String,
    /// 批前/后像不可存档的原因(继承自 anchor 的 skip:超大/符号链接/冲突)
    #[serde(default)]
    pub skip: Option<String>,
    /// 本轮 AI 写入事件计数(events 归因;git 归因 = 0)
    #[serde(default)]
    pub edit_count: u32,
}

/// 锚点随批固化的标注引用(标记 id + 冻结区间;发送时点快照,不随漂移重算)。
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CkptMarkRef {
    pub mark_id: String,
    /// 工作区内路径(与 TurnFile.path 同口径)
    pub path: String,
    /// 1 基闭区间(标记发送时刻的行号,sent 标注冻结)
    pub start_line: u32,
    pub end_line: u32,
}

/// 账本条目。同一 id 可追加多行(turn 封口修订),读取以最后一行为准。
/// edit 行按 (kind, id, path) 折叠 —— 每轮每文件一行,重复事件修订计数。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    /// "anchor" | "turn" | "guard" | "edit"
    pub kind: String,
    /// ms epoch(anchor/turn/edit = 锚点时刻或事件首击;guard = 回退时刻)
    pub ts: i64,
    /// 会话身份:写入时刻的规范 id(已绑 CLI 身份则 = CLI id,否则 = tmd 会话 id)
    pub session_id: String,
    /// tmd 会话 id(恒填;CLI 身份回填/查询副键)
    #[serde(default)]
    pub tmd_session_id: String,
    /// 1-based 会话内轮次(anchor/turn/edit 条目;guard = 0)
    #[serde(default)]
    pub turn: u64,
    /// 锚点 prompt 摘要(anchor/turn 条目)
    #[serde(default)]
    pub prompt: String,
    /// 锚点时刻快照:引擎显示名 / 模型 / 思考强度(空串 = 未知;旧账本条目缺省为空)
    #[serde(default)]
    pub engine: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub thinking: String,
    /// anchor/turn 条目:本轮 prompt 随发携带的标注引用(发送时点冻结;
    /// 旧账本条目缺省为空)。seal 修订行从锚点复制(读取以最后一行为准)。
    #[serde(default)]
    pub marks_refs: Vec<CkptMarkRef>,
    /// turn 封口时刻(ms;修订追加时刷新);edit 行复用为末次事件时刻
    #[serde(default)]
    pub seal_ts: i64,
    /// guard 所属批次 id
    #[serde(default)]
    pub batch_id: String,
    /// anchor/guard 条目:时刻工作区基线
    #[serde(default)]
    pub files: Vec<SnapFile>,
    /// turn 条目:固化变更集
    #[serde(default)]
    pub turn_files: Vec<TurnFile>,
    /// 归因模式,随锚点固化:"events"(AI 写入事件流,设计点「跟随 AI 输出」)
    /// | "git"(窗口内 git status 推断,未声明 editMarks 的 CLI 回退)。
    /// 旧账本条目缺省 = "git"(当时的唯一模式)。
    #[serde(default)]
    pub attribution: String,
    /// edit 行专用:事件目标路径(工作区内相对 / 工作区外绝对,经
    /// canonicalize_event_path 单闸归一)
    #[serde(default)]
    pub path: String,
    /// 用户 git 对象存活;anchor 基线解析不到 = 空串,seal 时按无前像处理)
    #[serde(default)]
    pub before_oid: String,
    /// edit 行专用:首击时刻的磁盘内容快照(sidecar blob;轮内中间态的
    /// 账本轨迹,审计可见,不参与回退语义)
    #[serde(default)]
    pub snap_oid: String,
    /// edit 行专用:本轮该文件的 AI 写入事件计数
    #[serde(default)]
    pub edit_count: u32,
}

/// 批次审核态(persist 覆盖项)。done 不落盘 —— 由 list 现场推导(提交/失配)。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatchState {
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub guard_id: Option<String>,
    /// 守卫链(追加序):单文件回退各自持精准快照,反悔按路径取最近覆盖它的
    /// guard —— 单槽 guard_id 被最后一次覆盖,多次部分回退后反悔会丢更早路径
    /// (2026-09-28 评审 F-CKPT-001)。guard_id 镜像最后一次,旧读者兼容。
    #[serde(default)]
    pub guard_ids: Vec<String>,
    #[serde(default)]
    pub reverted_paths: Vec<String>,
}

/// list 推导出的批次文件(含 live 分类,UI 直接消费)。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchFile {
    pub path: String,
    /// 批次发生时的 git 状态符(A/M/D)
    pub status: String,
    /// 已被单文件/整批回退
    pub reverted: bool,
    /// live 相对批后像:same(未动,可回退)| changed(内容已变)| committed(已入 git)
    pub live: String,
    /// live == "changed" 的便捷标记(不可回退,仅可对照)
    pub stale: bool,
    /// 本轮 AI 写入事件计数(events 归因的轨迹;git 归因 = 0)
    pub edit_count: u32,
    /// 工作区外首轮无前像(批前像不可知):禁回退,仅可查看 / 应用
    pub no_baseline: bool,
}

/// list 推导出的批次。id = 起始 anchor 的条目 id(稳定);index = 账本轮次。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchInfo {
    pub id: String,
    /// 会话内 1-based 轮次(账本记录;纯阅读轮缺号 = 真实轮次)
    pub index: u64,
    /// true = 尚未封口(最后一个 anchor 之后)
    pub open: bool,
    pub ts: i64,
    pub ts_end: Option<i64>,
    pub session_id: String,
    pub prompt: String,
    /// 锚点时刻快照:引擎显示名 / 模型 / 思考强度(继承锚点条目)
    pub engine: String,
    pub model: String,
    pub thinking: String,
    /// pending | reverted | done(现场推导)
    pub state: String,
    pub done_reason: Option<String>,
    pub guard_id: Option<String>,
    pub files: Vec<BatchFile>,
    /// 归因模式:"events"(AI 事件流)| "git"(推断;UI 提示可信度)
    pub attribution: String,
    /// 本轮锚点携带的标注引用(继承锚点条目;open 轮也有)
    pub marks_refs: Vec<CkptMarkRef>,
}
