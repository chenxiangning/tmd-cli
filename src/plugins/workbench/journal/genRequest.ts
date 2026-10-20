/**
 * 跨插件生成入口:footprint「AI 补归纳」把某日日报生成入队(仅 footprint 消费)。
 * 功能卡(footprint features JSON)随同一生成会话直写(spec L3 管线 A),
 * 引擎/模型取工作台日报生成设置,零新增调度。插件间声明模块消费先例:
 * GenSettings → memory-coordinator/modelCatalog;footprint 侧必须动态 import
 * —— 本族 FlowView 静态依赖 footprint/fpTab,静态互依成环。
 */
import { bootJournal, dayMetaOf, getJournalState } from "./journalStore";
import { dailyPaths, readText } from "./journalFiles";
import { dayGenTaskType, enqueueTask } from "./taskQueue";

/** 请求某日生成:上次失败走重试,已有文章走增量并入,否则手动生成。
 *  返回 true = 已入队;false = 该日已有任务在队(enqueueTask 日粒度闸)。 */
export async function requestDayGenerate(key: string): Promise<boolean> {
  await bootJournal().catch(() => undefined); /* 未就绪兜底:配置回落 DEFAULT(omp),下轮生成仍以实际配置执行 */
  const [y, m, d] = [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))];
  const paths = await dailyPaths();
  const hasArticle = !!(await readText(paths.article(y, m, d)));
  const failed = !!dayMetaOf(key).lastError;
  return enqueueTask(dayGenTaskType(failed, hasArticle), key, getJournalState().config.engine) !== null;
}
