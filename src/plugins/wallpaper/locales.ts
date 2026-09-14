/**
 * wallpaper 域词典(wallpaper 插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。随插件词典纪律补齐(2026-09-14 评审)。
 */
import { registerMessages } from "@kernel/i18n";

const MESSAGES_EN = {
  工作区背景: "Workspace backdrop",
  "工作区背景：流体着色器与本地图库壁纸":
    "Workspace backdrop: fluid shaders and a local image library",
  "工作区背景壁纸：本地图库与效果。":
    "Workspace backdrop wallpaper: local library and effects.",
  壁纸: "Wallpaper",
  图库: "Library",
  "图库({count})": "Library ({count})",
  "图库为空,点「导入图片」选择本地图片。":
    'Library is empty. Click "Import images" to pick local pictures.',
  "图库可见项达到 2 张后可开启。":
    "Available once the library has at least 2 visible items.",
  图片: "Image",
  填充: "Fill",
  "填充=拉伸铺满；居中=原尺寸不缩放。":
    "Fill = stretch to cover; Center = original size, no scaling.",
  壁纸暗化: "Wallpaper dim",
  壁纸模糊: "Wallpaper blur",
  "导入中…": "Importing…",
  导入图片: "Import images",
  "尚未选择；导入并点选一张图片后生效。":
    "Nothing selected yet; import and click a picture to apply it.",
  居中: "Center",
  "已隐藏({count})": "Hidden ({count})",
  开启: "On",
  关闭: "Off",
  当前壁纸: "Current wallpaper",
  恢复到图库: "Restore to library",
  "按间隔在图库可见项间轮流切换。":
    "Cycles through visible library items at a fixed interval.",
  无法预览: "Preview unavailable",
  查看已隐藏: "View hidden",
  水平翻转: "Flip horizontally",
  "没有已隐藏的壁纸。": "No hidden wallpapers.",
  流体: "Fluid",
  "流体着色器动态背景，或本地图库壁纸；界面各栏随之变为半透明磨砂。":
    "Dynamic fluid shader or local library wallpaper; panels turn translucent frosted glass to match.",
  流体运动: "Fluid motion",
  流体预设: "Fluid preset",
  "漂移=域扭曲流场；太极/风暴/龙卷/游龙为独立着色程序。":
    "Drift = domain-warped flow; Tai Chi / Storm / Tornado / Serpent are standalone shader programs.",
  "移入废纸篓并从图库移除": "Move to trash and remove from library",
  背景暗化: "Backdrop dim",
  自动轮播: "Auto rotate",
  轮播间隔: "Rotation interval",
  返回图库: "Back to library",
  适应: "Fit",
  选择壁纸: "Choose wallpaper",
  选择壁纸图片: "Choose wallpaper image",
  铺放方式: "Placement",
  铺满: "Cover",
  "{minutes} 分钟": "{minutes} min",
  "七组色相/深度组合，随明暗主题各出一套配色。":
    "Seven hue/depth pairings; each ships its own light and dark palette.",
  "加在壁纸本身（非界面毛玻璃），0 = 清晰。":
    "Applied to the wallpaper itself (not UI frosted glass); 0 = sharp.",
  "压暗壁纸提升界面文字对比。":
    "Dims the wallpaper to boost UI text contrast.",
  "压暗流体背景，提升界面文字对比。":
    "Dims the fluid backdrop to boost UI text contrast.",
  薄雾: "Mist",
  极光: "Aurora",
  暮色: "Dusk",
  兰紫: "Lavender",
  烬红: "Ember",
  墨蓝: "Deep Blue",
  灰烬: "Ash",
  漂移: "Drift",
  太极: "Tai Chi",
  风暴: "Storm",
  龙卷: "Tornado",
  游龙: "Serpent",
};

const MESSAGES_JA = {
  工作区背景: "ワークスペース背景",
  "工作区背景：流体着色器与本地图库壁纸":
    "ワークスペース背景:流体シェーダーとローカル画像ライブラリ",
  "工作区背景壁纸：本地图库与效果。":
    "ワークスペース背景壁紙:ローカルライブラリとエフェクト。",
  壁纸: "壁紙",
  图库: "ライブラリ",
  "图库({count})": "ライブラリ({count})",
  "图库为空,点「导入图片」选择本地图片。":
    "ライブラリが空です。「画像を読み込む」からローカル画像を選択してください。",
  "图库可见项达到 2 张后可开启。":
    "表示中のライブラリ項目が2枚になると有効化できます。",
  图片: "画像",
  填充: "引き伸ばし",
  "填充=拉伸铺满；居中=原尺寸不缩放。":
    "引き伸ばし=全面に拡大;中央=原寸大のまま縮小なし。",
  壁纸暗化: "壁紙の暗さ",
  壁纸模糊: "壁紙のぼかし",
  "导入中…": "読み込み中…",
  导入图片: "画像を読み込む",
  "尚未选择；导入并点选一张图片后生效。":
    "未選択。読み込んで画像をクリックすると反映されます。",
  居中: "中央",
  "已隐藏({count})": "非表示({count})",
  开启: "オン",
  关闭: "オフ",
  当前壁纸: "現在の壁紙",
  恢复到图库: "ライブラリに戻す",
  "按间隔在图库可见项间轮流切换。":
    "一定間隔で表示中のライブラリ項目を切り替えます。",
  无法预览: "プレビューできません",
  查看已隐藏: "非表示を表示",
  水平翻转: "左右反転",
  "没有已隐藏的壁纸。": "隠した壁紙はありません。",
  流体: "流体",
  "流体着色器动态背景，或本地图库壁纸；界面各栏随之变为半透明磨砂。":
    "流体シェーダーのダイナミック背景、またはローカル画像の壁紙。各パネルが半透明のすりガラスに変わります。",
  流体运动: "流体モーション",
  流体预设: "流体プリセット",
  "漂移=域扭曲流场；太极/风暴/龙卷/游龙为独立着色程序。":
    "ドリフト=ドメインワープの流れ場;太極/嵐/竜巻/遊龍は独立したシェーダープログラム。",
  "移入废纸篓并从图库移除": "ゴミ箱へ移動してライブラリから削除",
  背景暗化: "背景の暗さ",
  自动轮播: "自動ローテーション",
  轮播间隔: "ローテーション間隔",
  返回图库: "ライブラリに戻る",
  适应: "収める",
  选择壁纸: "壁紙を選択",
  选择壁纸图片: "壁紙画像を選択",
  铺放方式: "配置方法",
  铺满: "覆う",
  "{minutes} 分钟": "{minutes} 分",
  "七组色相/深度组合，随明暗主题各出一套配色。":
    "明暗テーマそれぞれに対応した7組の色相/深度の組み合わせ。",
  "加在壁纸本身（非界面毛玻璃），0 = 清晰。":
    "壁紙そのものに適用(UIのすりガラスではなく)、0 = クリア。",
  "压暗壁纸提升界面文字对比。":
    "壁紙を暗くしてUIテキストのコントラストを高めます。",
  "压暗流体背景，提升界面文字对比。":
    "流体背景を暗くしてUIテキストのコントラストを高めます。",
  薄雾: "薄霧",
  极光: "オーロラ",
  暮色: "夕暮れ",
  兰紫: "藍紫",
  烬红: "燼紅",
  墨蓝: "墨藍",
  灰烬: "灰燼",
  漂移: "ドリフト",
  太极: "太極",
  风暴: "嵐",
  龙卷: "竜巻",
  游龙: "遊龍",
};

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
