/**
 * docgen 阅读器 · 分发动作条(复制/存项目文档/发送输入框/就此追问/重新生成)。
 * 自 DocGenReader 拆出守 300 行铁则。
 */
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { composerInsertRef } from "@kernel/composerExt";
import { getWorkspaces } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { pickSavePath } from "@kernel/ipc";
import { createEntry, dimensionKeyOf } from "./store";
import { writeText } from "./paths";
import { enqueueDocGenTask } from "./queue";
import { resolveTargetProjectId, buildAskPrompt } from "../docgenView";
import { createDoc } from "../store";
import type { DocGenEntry } from "./types";
import type { Project } from "../types";

/** done 态底部分发动作:复制/存项目文档/发送输入框/就此追问/重新生成。 */
export function ReaderFoot({ entry, projects, md, onToast }: {
  entry: DocGenEntry;
  projects: readonly Project[];
  md: string | undefined;
  onToast: (m: string) => void;
}) {
  const copyMd = () => {
    if (!md) return;
    void navigator.clipboard?.writeText(md).then(
      () => onToast(t("已复制 markdown 原文")),
      () => onToast(t("复制失败")),
    );
  };
  const saveAsDoc = () => {
    if (!md) return;
    const target = resolveTargetProjectId(entry, projects);
    if (!target.projectId) {
      onToast(t("没有可落的目标项目"));
      return;
    }
    void createDoc(target.projectId, { title: entry.title, markdown: md }).then(
      () => onToast(target.fallback ? t("已存为项目文档:{name}(全部项目范围默认落第一个进行中项目)", { name: target.projectName }) : t("已存为项目文档:{name}", { name: target.projectName })),
      (e) => onToast(e instanceof Error ? e.message : String(e)),
    );
  };
  const exportMd = () => {
    if (!md) return;
    const name = `${entry.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
    void pickSavePath(t("导出文档"), name).then((path) => {
      if (!path) return; /* 用户取消/web 桩态:静默 */
      void writeText(path, md).then(
        () => onToast(t("已导出:{path}", { path })),
        (e) => onToast(e instanceof Error ? e.message : String(e)),
      );
    });
  };
  const sendToComposer = () => {
    if (!md) return;
    if (!composerInsertRef.current) {
      onToast(t("会话输入框未挂载,请先打开一个会话"));
      return;
    }
    composerInsertRef.current(md);
    onToast(t("已发送到会话输入框"));
  };
  const askHere = () => {
    if (!md) return;
    const ws = getWorkspaces().find((w) => !findWorkspaceOrigin(w)?.remoteExec);
    if (!ws) {
      onToast(t("无本地工作区"));
      return;
    }
    void host.createSession(entry.engine, ws.root, ws.id).then((meta) => {
      void host.writeSession(meta.id, buildAskPrompt(entry, md)).then((sent) => {
        if (!sent) {
          onToast(t("提示词未能送达"));
          return;
        }
        host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
        host.setActiveSession(meta.id);
      });
    }, () => onToast(t("创建会话失败")));
  };
  const regen = () => {
    void createEntry({
      templateId: entry.templateId, title: entry.title, scope: entry.scope,
      periodKey: entry.periodKey, periodLabel: entry.periodLabel,
      periodFrom: entry.periodFrom, periodTo: entry.periodTo,
      audience: entry.audience, engine: entry.engine, sources: entry.sources,
      additional: entry.additional, language: entry.language,
    }).then((e) => {
      const queued = enqueueDocGenTask("重试生成", e.id, dimensionKeyOf(e.templateId, e.scope, e.periodKey), e.engine);
      onToast(queued ? t("已重新入队:产出将存为新版本") : t("同维度已有任务在队列/运行中"));
    });
  };
  return (
    <div className="dg-reader-foot">
      <button type="button" className="wb-btn" onClick={copyMd}>{t("复制 MD")}</button>
      <button type="button" className="wb-btn" onClick={exportMd}>{t("导出")}</button>
      <button type="button" className="wb-btn" onClick={saveAsDoc}>{t("存为项目文档")}</button>
      <button type="button" className="wb-btn" onClick={sendToComposer}>{t("发送到输入框")}</button>
      <button type="button" className="wb-btn" onClick={askHere}>{t("就此追问")}</button>
      <span className="dg-sp" />
      <button type="button" className="wb-btn" onClick={regen}>{t("重新生成")}</button>
    </div>
  );
}
