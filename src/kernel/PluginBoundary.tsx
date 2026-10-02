/**
 * 插件贡献渲染边界 —— 渲染抛错只塌该贡献位,崩溃按插件归属计数。
 * 贡献组件在注册期(contributionLedger)统一包裹本边界:挂点/中央 tab/
 * 右栏面板/设置 section/首页面板/市场面板六类渲染面一处包装全覆盖。
 * 塌陷呈现 = 就地最小错误条(归属插件 + 原因):静默 null 在深色主题下
 * 等同整块黑屏,用户无从归因、现场无法留证(0.2.5 画布黑屏排查结论)。
 * 0.2.7 打磨:文案过 t()(en/ja 不再露中文);加「重试该贡献位」钮(gen
 * 递增强制重挂子树,不必重启应用)。
 */
import { Component, Fragment, type ReactNode } from "react";
import { t } from "./i18n";
import { recordPluginCrash } from "./pluginQuarantine";

interface Props {
  pluginId: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
  detail: string;
  /** 重试代数:key 递增强制重挂子树(全新组件树,旧错误态不残留)。 */
  gen: number;
}

export class PluginBoundary extends Component<Props, State> {
  override state = { failed: false, detail: "", gen: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, detail: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[plugin] 贡献组件渲染失败(${this.props.pluginId}):`, error);
    recordPluginCrash(this.props.pluginId, reason);
  }

  override render() {
    if (this.state.failed) {
      return (
        <div
          className="plugin-boundary-fallback"
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            margin: "auto",
            maxWidth: 420,
            padding: "18px 20px",
            borderRadius: 10,
            border: "1px solid var(--tmd-border, #3a3a3a)",
            background: "var(--tmd-bg-elevated, #232323)",
            color: "var(--tmd-fg-muted)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {t("插件「{id}」界面渲染崩溃,该贡献位已停用", { id: this.props.pluginId })}
          </span>
          <span style={{ opacity: 0.72, wordBreak: "break-all" }}>{this.state.detail}</span>
          <span style={{ opacity: 0.55 }}>
            {t("重启应用或重载页面可重置;反复出现请反馈本条原因文案。")}
          </span>
          <button
            type="button"
            onClick={() =>
              this.setState((s) => ({ failed: false, detail: "", gen: s.gen + 1 }))
            }
            style={{
              alignSelf: "flex-start",
              marginTop: 2,
              padding: "3px 12px",
              borderRadius: 6,
              border: "1px solid var(--tmd-border, #3a3a3a)",
              background: "var(--tmd-bg-hover, #2a2a2a)",
              color: "var(--tmd-fg, #cccccc)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("重试该贡献位")}
          </button>
        </div>
      );
    }
    /* key=gen:重试时整棵子树重挂;平时 gen 恒定,渲染行为与从前一致。 */
    return <Fragment key={this.state.gen}>{this.props.children}</Fragment>;
  }
}
