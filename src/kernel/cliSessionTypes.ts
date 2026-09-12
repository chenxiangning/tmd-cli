/**
 * CLI 会话内省数据单元 —— 自 cli.ts 迁出(文件规模铁则)。
 * 磁盘会话/状态/身份自证/用户消息/写入事件/远程 exec 通道的纯类型,
 * cli.ts re-export 保持既有 import 契约不变。
 */

/**
 * CLI 磁盘会话 —— 从该 CLI 自己的会话存储扫描出的历史会话。
 * tmd-cli 不做会话映射:列表数据源的真相在各 CLI 的磁盘目录。
 */
export interface CliDiskSession {
  /** CLI 自身的会话 id(omp/pi 的 jsonl uuid、codex 的 rollout id),直接喂 resumeArgs。 */
  id: string;
  /** 展示标题;缺省由 UI 回退到短 id。 */
  title?: string;
  /** 最近修改时间 ms epoch,排序/相对时间展示用。 */
  modifiedAt: number;
  /** 磁盘文件路径(调试用)。 */
  path: string;
  /** 会话创建时刻 ms epoch(远程形态从文件头身份行提取;本地由内核另测)。
   *  远程会话身份绑定用:spawn 时刻之后创建的最早会话即本会话。 */
  createdAt?: number;
}

/** 远程宿主内的 shell 执行(来源提供传输,如 WSL 的 ssh+b64 通道;PS 安全)。
 *  传引擎适配器的脚本串,返回 stdout;无数据/无匹配返回空串而非报错。 */
export type RemoteExec = (sh: string) => Promise<string>;

/**
 * 会话文件内容自证的身份(readSessionFileIdentity 的返回)。
 * id 必填;cwd/createdAt 缺失表示该 CLI 不自证对应维度,内核按其余维度匹配。
 */
export interface SessionFileIdentity {
  /** CLI 会话 id(resumeArgs 可直接消费的形态)。 */
  id: string;
  /** 会话创建 cwd。 */
  cwd?: string;
  /** 会话创建时刻 ms epoch(omp/pi 来自 session 行 timestamp,codex 来自 meta)。 */
  createdAt?: number;
}

/**
 * CLI 会话当前的只读运行状态。
 * 字段缺失表示对应 CLI 尚未刷盘或格式暂未识别。
 */
export interface CliSessionStatus {
  model?: string;
  thinkingLevel?: string;
}

/** 会话文件中的一条真实用户输入 —— 对话锚点栏的数据单元。 */
export interface CliUserMessage {
  /** CLI 消息 id(omp/pi 的 message id、claude 的 uuid、codex 的 payload id),跨增量窗口去重用。 */
  id: string;
  /** 完整文本:预览卡内容与幕布定位 needle 的共同来源。 */
  text: string;
}

/**
 * 会话磁盘事件流中的一条 AI 写入事件(readSessionEdits 的返回单元)。
 * 审批线 events 归因的第二信号源:与 editMarks(PTY 输出标记)互补,
 * 从该 CLI 自己的会话 JSONL 提取,天然按会话隔离,并行会话零串扰。
 */
export interface CliSessionEdit {
  /** 写入文件路径(cwd 内记相对;cwd 外绝对或 ~/ 形式原样上抛,Rust 单闸终审归一)。 */
  path: string;
  /** 写入发生时刻 ms epoch(取自 CLI 自记的时间戳,非观测时刻)。 */
  ts: number;
}
