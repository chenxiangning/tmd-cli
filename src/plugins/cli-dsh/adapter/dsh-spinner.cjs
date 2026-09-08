/**
 * 轮次 spinner —— omp loader 同款(⠋帧 80ms accent + muted 消息 + 秒数)。
 * 不再自写 \r\x1b[K:底栏行所有权在 dsh-stream,这里只经 setStatus 更新文本。
 * start 幂等(先停旧);stop 只停表,底栏归谁显示(idle/空)由调用方定。
 */

const T = require("./dsh-theme.cjs");
const render = require("./dsh-render.cjs");

function createSpinner(setStatus) {
  let timer = null;
  let idx = 0;
  let label = "";
  let startedAt = 0;

  const draw = () => {
    const secs = startedAt ? ` ${((Date.now() - startedAt) / 1000).toFixed(1)}s` : "";
    setStatus(`${render.spinnerFrame(idx++)} ${T.fg("muted", label + secs)}`);
  };

  return {
    start(l, t0) {
      this.stop();
      label = l; startedAt = t0 || 0; idx = 0;
      draw();
      timer = setInterval(draw, render.SPINNER_INTERVAL_MS);
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    active() { return timer !== null; },
  };
}

module.exports = { createSpinner };
