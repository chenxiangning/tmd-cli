/**
 * 智能体 tab —— 设置 section「智能体 / 提示词」的智能体管理页:
 * 列表(icon + 名称 + prompt 首行)/ 新建 / 编辑 / 删除 + 「从 codemoss 导入」
 * (~/.ccgui/agent.json 合并,撞名加 (N) 后缀)。编辑弹窗与列表同文件(规模内)。
 */

import { useState } from "react";
import { DownloadSimple, Pencil, Plus, Robot, Trash } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { importCodemossAgents } from "../importCodemoss";
import { deleteAgent, saveAgent, useAssets, type Agent } from "../store";

export function AgentTab() {
  const { agents } = useAssets();
  const [editing, setEditing] = useState<Agent | "new" | null>(null);
  const [report, setReport] = useState("");

  const remove = async (agent: Agent) => {
    if (!window.confirm(t("删除智能体「{name}」?已选中的会话会自动取消。", { name: agent.name }))) return;
    if (!(await deleteAgent(agent.id))) setReport(t("删除失败:写入磁盘未成功"));
  };

  const importFromCodemoss = async () => {
    setReport(t("导入中…"));
    const r = await importCodemossAgents().catch(() => null);
    setReport(r ? t("导入 {a} 个智能体,跳过 {s} 条", { a: r.agents, s: r.skipped }) : t("导入失败:~/.ccgui/agent.json 不可读"));
  };

  return (
    <div className="assets-tab">
      <div className="assets-toolbar">
        <button type="button" className="assets-btn is-primary" onClick={() => setEditing("new")}>
          <Plus size="0.75rem" /> {t("新建智能体")}
        </button>
        <button type="button" className="assets-btn" onClick={() => void importFromCodemoss()}>
          <DownloadSimple size="0.75rem" /> {t("从 codemoss 导入")}
        </button>
        {report && <span className="assets-report">{report}</span>}
        <span className="assets-count">{t("{n} 个智能体", { n: agents.length })}</span>
      </div>
      {agents.length === 0 ? (
        <div className="assets-empty">
          {t("还没有智能体。新建一个,或从 codemoss 一键导入;composer 里 ## 选中后,发送时会在消息尾拼角色块。")}
        </div>
      ) : (
        <div className="assets-card-list">
          {agents.map((agent) => (
            <div className="assets-card" key={agent.id}>
              <span className="assets-card-icon" aria-hidden>
                {agent.icon ?? <Robot size="1rem" />}
              </span>
              <div className="assets-card-main">
                <div className="assets-card-name">{agent.name}</div>
                <div className="assets-card-desc">
                  {(agent.prompt.split("\n").find((l) => l.trim()) ?? "").trim()}
                </div>
              </div>
              <div className="assets-card-actions">
                <button type="button" className="assets-btn" onClick={() => setEditing(agent)}>
                  <Pencil size="0.75rem" /> {t("编辑")}
                </button>
                <button type="button" className="assets-btn is-danger" onClick={() => void remove(agent)}>
                  <Trash size="0.75rem" /> {t("删除")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <AgentModal
          agent={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AgentModal({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const [name, setName] = useState(agent?.name ?? "");
  const [icon, setIcon] = useState(agent?.icon ?? "");
  const [prompt, setPrompt] = useState(agent?.prompt ?? "");
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim()) {
      setError(t("名称必填"));
      return;
    }
    const saved = await saveAgent({ id: agent?.id, name, icon, prompt });
    if (!saved) {
      setError(t("名称已存在,或写入磁盘失败"));
      return;
    }
    onClose();
  };

  return (
    <div className="assets-modal-backdrop" onClick={onClose}>
      <div className="assets-modal" onClick={(e) => e.stopPropagation()}>
        <div className="assets-modal-title">{agent ? t("编辑智能体") : t("新建智能体")}</div>
        <label className="assets-field">
          <span>{t("名称")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("如:小张")} autoFocus />
        </label>
        <label className="assets-field">
          <span>{t("图标(单个 emoji,可空)")}</span>
          <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🤖" maxLength={4} />
        </label>
        <label className="assets-field">
          <span>{t("角色 prompt(发送时拼在用户消息尾部)")}</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            placeholder={t("如:你是产品交互大神,回答先给结论与理由…")}
          />
        </label>
        {error && <div className="assets-error">{error}</div>}
        <div className="assets-modal-actions">
          <button type="button" className="assets-btn" onClick={onClose}>{t("取消")}</button>
          <button type="button" className="assets-btn is-primary" onClick={() => void submit()}>{t("保存")}</button>
        </div>
      </div>
    </div>
  );
}
