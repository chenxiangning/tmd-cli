/**
 * 引擎品牌标记 —— 插件内共享件(自 ArticleTab 抽出):renderIcon 注册面取
 * glyph(cli 各插件声明制),未登记回落 stringHue 彩点。设置页/月格/文章 tab/
 * 任务卡四处同源,消哈希彩点与品牌 logo 双轨。
 */
import { host } from "@kernel/host";
import { stringHue } from "@kernel/colorHash";

export function EngMark({ id }: { id: string }) {
  const render = host.getCliProfiles().find((p) => p.id === id)?.renderIcon;
  if (render) return <span className="dj-engmark">{render("0.8125rem")}</span>;
  return <i className="dj-engdot" style={{ background: `hsl(${stringHue(id)} 52% 48%)` }} />;
}
