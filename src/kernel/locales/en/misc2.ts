/** en 词典 · misc 续域(misc.ts 满 300 行后按 cli2/git2 惯例拆分)。 */
export const MESSAGES = {
  // cli-dsh hostPanel(状态文案与探针失败原因)
  "host 拒绝了本端来源(Host/Origin 栅栏):非回环地址需在 DSH 侧配 trustedHosts。":
  "The host rejected this origin (Host/Origin fence): non-loopback addresses must be listed in trustedHosts on the DSH side.",
  "0.0.0.0/:: 不能作为 DSH 监听地址(DSH 启动期直接拒绝)。请填 127.0.0.1 再用 --trusted-host 暴露。":
  "0.0.0.0/:: can't be the DSH listen address (DSH refuses it at startup). Use 127.0.0.1 and expose it via --trusted-host instead.",
  "远程 origin 连不上。tmd-cli 只代管本机 host,远程请先在那边起 dsh web。":
  "Can't reach the remote origin. tmd-cli only manages local hosts; start dsh web on the remote side first.",
  "正在停止…": "Stopping…",
  "正在检测…": "Checking…",
  "只信 settings/describe 探针,不把端口通当作已就绪。":
  "Only the settings/describe probe counts as ready; an open port alone doesn't.",
};
