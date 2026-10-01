/**
 * 审批卡危险启发式(纯函数,单测守护)—— 自 confirmCard.tsx 迁出
 * (react-doctor 组件文件只出组件):标题/正文命中破坏性词即危险,批准钮
 * 染红实底。误报只是多一分警示,不放行任何操作。
 */
const DANGER_RE =
  /(\brm\s|-rf|del(ete|eted)?\b|remove|format|overwrite|push\b|drop\b|truncate|curl|wget|chmod|chown|sudo|删除|移除|覆写|覆盖|格式化|清空|强推|发布)/i;

export function isDangerConfirm(title: string, message: string): boolean {
  return DANGER_RE.test(title) || DANGER_RE.test(message);
}
