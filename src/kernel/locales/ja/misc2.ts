/** ja 词典 · misc 续域(misc.ts 满 300 行后按 cli2/git2 惯例拆分)。 */
export const MESSAGES = {
  // cli-dsh hostPanel(状态文案与探针失败原因)
  "host 拒绝了本端来源(Host/Origin 栅栏):非回环地址需在 DSH 侧配 trustedHosts。":
  "host がこのオリジンを拒否しました(Host/Origin フェンス)。非ループバックアドレスは DSH 側の trustedHosts に登録してください。",
  "0.0.0.0/:: 不能作为 DSH 监听地址(DSH 启动期直接拒绝)。请填 127.0.0.1 再用 --trusted-host 暴露。":
  "0.0.0.0/:: は DSH のリッスンアドレスにできません(起動時に拒否されます)。127.0.0.1 を指定し、--trusted-host で公開してください。",
  "远程 origin 连不上。tmd-cli 只代管本机 host,远程请先在那边起 dsh web。":
  "リモート origin に接続できません。tmd-cli が管理するのはローカル host のみです。リモート側で先に dsh web を起動してください。",
  "正在停止…": "停止中…",
  "正在检测…": "確認中…",
  "只信 settings/describe 探针,不把端口通当作已就绪。":
  "settings/describe プローブのみを信頼し、ポートが開いているだけでは準備完了とみなしません。",
};
