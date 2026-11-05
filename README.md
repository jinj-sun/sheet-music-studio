# 谱写 Studio 2.0

本地运行的钢琴谱编辑与图片校对工作台。React 19、TypeScript、Vite 8、OSMD 2.2.1、homr-web 0.5.4。无需平台账号或服务端。

## 启动

要求 Node.js 22.22+（22.x）或 24+、npm 10+，推荐桌面版 Chrome / Edge。

```powershell
cd 'D:\孙晋晶\codex\sheet-music-studio'
npm ci
npm run dev
```

打开 http://127.0.0.1:5173/ 。也可使用 `npm install` 安装依赖。

```powershell
npm run build
npm run preview
```

生产构建在 `dist/`，预览地址 http://127.0.0.1:4173/ 。部署时完整提供 `dist/` 中的静态文件，使用 HTTP(S)；不要直接双击 HTML。`base: './'` 支持带末尾斜杠的子目录部署。

`.npmrc` 使用 npm 官方源并设置 `ignore-scripts=true`，避免 OSMD 的可选 Node/OpenGL 依赖执行原生编译。本应用使用浏览器 SVG 渲染。`dev`、`build` 会显式运行 `prepare-omr.mjs`，复制锁定版本的 ONNX `.mjs/.wasm` 文件并同步模型清单，依赖不需要安装脚本来启用应用功能。新依赖若确实需要安装脚本，应单独审查并调整此配置。

## 编辑与校对

1. **新建钢琴谱**生成高音、低音双谱表及四分休止符。原有“小星星”示例仍可加载。
2. 点击谱面音头或底部音符列表，选择单个音符。和弦音可独立选择，属性面板提供前后音符导航。
3. 属性面板可改音高、升降号、重升重降、八度、时值、附点、休止符；“添加和弦音”使用面板中的音高。支持延音线和不同音高间的连奏线。
4. “插入音符”展开插入表单：选择乐器、小节、谱表、声部和起点。**起点从 0 算起，四分音符为 1 拍**。空拍插入不会覆盖已有音符；不同声部可以同时开始。普通单音删除后保留等时休止符，删除和弦主音会提升剩余音。
5. 时值修改作用于当前和弦组，保持其他音符和声部起点；缩短后留下可插入的空拍。增长时不可覆盖同声部下一音符或越过小节。
6. 支持 100 步撤销/重做，快捷键 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y；Delete 删除当前音符。输入框内使用原生编辑快捷键。
7. 上传 PNG、JPEG、WebP 原图后切换“并排校对”，分别缩放原图和谱面，逐音符修改并标记已校对。桌面为双栏，小屏纵向排列；谱面保持可横向滚动。引擎提供的谱行框可在原图中定位，**不伪造逐音符坐标或置信度**。
8. 原图上限 25 MB / 4000 万像素；XML/MXL 导入上限 30 MB，主 XML 上限 20 MB，MXL 解压内容上限 100 MB。PDF/TIFF/HEIC 请先逐页转换为 PNG。一次可选或拖入多张原图，最多 60 页、全部原图合计约 80 MB。

## 乐谱保真与数据

- **原始 MusicXML DOM 是唯一编辑源**。显示、播放、MIDI 都派生自它；不把简化音符数组重新生成并覆盖复杂乐谱。
- 未编辑时 `xml` 字符串保持原样；图形编辑仅补丁修改目标字段。XMLSerializer 在编辑后可能调整引号、声明、命名空间等序列化形式，不承诺编辑后字节完全相同。原始导入文件另存，可随时下载，包含原始字节与编码。
- 歌词、力度、踏板、布局、反复、扩展节点等未经操作的信息保持在 XML 中。未知扩展没有被投影为编辑器字段时也不会被删除。
- MXL 按 `META-INF/container.xml` 指定主谱读取，所有附属文件留在项目中。**导出 MXL 或项目文件携带附件；单独导出 MusicXML 只含主 XML**。
- 无法安全修改的显式连梁时值、中途 divisions/属性变化、复杂装饰音删除等操作会拒绝并说明原因，可转到 XML 编辑。score-timewise 保留完整源码，但图形编辑、播放及 MIDI 暂停用；请在原制谱软件导出 partwise。
- XML 应用前检查语法、根节点和时间线结构；这不是完整的 MusicXML XSD 校验。错误不会覆盖已应用乐谱。未应用的源码草稿也保存到项目。
- 项目以独立 UUID 存入浏览器 IndexedDB，包含编辑稿、原始谱、原图、MXL 附件、引擎返回元数据及校对标记。切换前保存，过时自动保存不会覆盖较新版本；配额/写入失败有明确提示。
- `.studio.json` 导入始终生成新项目，不覆盖现有项目。请定期下载项目备份；清理浏览器站点数据、更换浏览器/设备/端口后，原库不会自动迁移。
- 源码包原有 `.env` 保留在本机且已忽略，不再参与纯前端运行；未删除或重写用户乐谱数据。

## 播放与 MIDI

共享 `music/timeline.ts` 处理 `divisions`、`duration`、`chord`、`backup`、`forward`、多乐器小节对齐、移调、速度变化和声音延音线。时值使用四分音符拍数，附点及连音实际时长以 MusicXML duration 为准。

浏览器使用本地 **Salamander 三角钢琴实录采样**（Alexander Holm，Yamaha C5，CC BY 3.0），替代原有三个正弦振荡器。30 个立体声 MP3 覆盖 A0–C8，小三度采样、邻近录音精确变调；按力度控制增益/低通，保留自然衰减，加入松键释放和总线压缩。这是单力度层子集，并非完整 16 层钢琴音源。提供播放、暂停、定位、停止、速度及音量；定位到长音中间会从录音对应衰减位置继续。采样随源码/构建分发（约 2 MB），运行时不访问外部音色 CDN；加载失败明确报错，停止播放并允许重试，不假装加载成功。授权与哈希见 `client/public/audio/piano/`。MIDI 使用同一时间线，格式 1、每声部/谱表分轨、9600 PPQ、速度轨与独立通道；保留首个 MIDI 乐器音色，最多 15 个独立通道。MIDI 节拍会量化到 tick，并非 MusicXML 的可逆替代格式。

反复/跳转暂按书写顺序演奏；倚音、提示小音符、踏板、奏法、微分音、装饰音、八度线等存在解释限制时，界面列明差异，**必须明确勾选接受近似方式，才能试听或导出 MIDI**。MusicXML/MXL 不受此播放限制，不会删去这些记号。

## 多页识谱、项目废纸篓与钢琴指法

- 点击左侧 **图片识谱** 开始一个新项目，在文件窗口多选同一首曲子的 PNG、JPEG、WebP；也可以把多张图片拖进当前项目。选中的一批按文件名中的数字自然排序（2 在 10 前），通过“页序与结果”的前移/后移核对顺序。“添加图片页”把新一批接在当前页末尾。
- 点击 **识别全部 N 页**。应用在一个 Worker 中逐页处理，显示当前页和阶段；每完成一页保存结果。取消、单页失败、模型缺失时保留原图与已完成页，重试跳过成功页。合谱成功会生成独立项目，原始识谱任务可继续重排合谱，不覆盖已编辑的项目。
- 合谱完整复制各页小节节点，统一小节序号，保留所有逐页原图、原始引擎 XML 与元数据；总谱采用第一页的页眉。翻页跳转至对应小节，播放跟随可同步原图页。乐器定义、谱表结构、重复 XML ID 或跨页继承的拍号/时值/移调不兼容时拒绝自动合谱；可独立打开或下载每页 XML。跨页延音、拍号误识及其他乐谱准确性仍要校对。
- **项目库 → 删除项目** 将该项目移到废纸篓，不删除其中的任何数据。**废纸篓 → 恢复项目** 可恢复；刷新保留废纸篓状态。暂不提供彻底删除；删除到废纸篓不会释放浏览器存储。原先的单页项目备份仍可导入，合谱项目备份携带全部页。
- **音符属性 → 钢琴指法** 可手动选择 1–5 或移除简单指法；也可生成当前小节/整曲双手建议，再勾选要附上的条目。建议按上谱表右手、下谱表左手计算，相邻音、同时和弦及持续按键都会参与判断。复杂换指、超出手型的组合会跳过；建议供校对，不替代演奏者的手型判断。仅应用后写入 MusicXML，可撤销，并在谱面/导出中保留已有及选定的新指法。

## 连梁、节奏校对与播放高亮

- 未指定 `<beam>` 的八分及更短音符自动连梁；仅影响显示，不改写导入的 XML。横梁与单独符尾不改变音符时值。自动排版不等于恢复原图所有手工分组。
- 属性面板“与下一音符连梁”可连接/扩展同小节同声部的连续音符；“清除手工连梁”后恢复自动排版。手工分组写入 XML，支持撤销/重做与导出。连音组、跨小节或含样式/扩展的复杂连梁保留源码编辑。
- 时值默认保持其他音符起点。选择“顺移本小节同声部后续音符”可修正 OMR 附点等误识，同时保持另一谱表/声部及方向记号的原时间锚。涉及延音、手工连梁、中途属性变化、带扩展的时间移动或小节尾部时间占位时保护性拒绝；先解除有关连线/连梁或使用 XML。
- 以 AudioContext 时间驱动橙色音头高亮，左右手、和弦、多声部同时显示；延音线续音按对应的记谱音符位置高亮。暂停/停止清除高亮，定位/变速同步更新。修复 SVG 内部路径固定黑色覆盖分组颜色的问题。
- “播放跟随谱面”可自动滚动到当前小节，开关只影响视图。识别模型没有因此改变，真实节奏错误仍须对照原图校正，不能只凭拍号自动猜测。

## 图片识谱模型

源码 Git/源码 ZIP 不含二进制模型。**当前机器 7/7 个模型已安装，大小与官方 SHA-256 全部通过校验**。实际 Chrome 中，开发版本约 24 秒、生产版本约 30 秒完成测试谱图的真实 WASM 推理，生成 16 个记谱音符的 MusicXML 并成功渲染；未模拟模型请求或替换识别输出。复杂谱图仍有拍号、音高、连音等误识，必须逐音符校对；这不是准确率认证。详见 [模型修复与真实推理验收](docs/OMR-MODEL-RECOVERY.md)。

```powershell
npm run models:download
npm run models:check
# 安装模型后重新构建，让生产 dist 包含模型
npm run build
```

下载器沿用 homr-web 官方脚本的来源：homr 的 `onnx_checkpoints` 发布资源、RapidOCR v3.9.2 的 ModelScope 资源及 homr-web 的 tab-digits 发布资源。下载完成后按**文件大小与 SHA-256**验证，再写入正式路径；已有正确文件直接复用。下载器每块 1 MiB，默认 6 路分块并发、最多 3 个模型同时传输，每块失败最多重试 3 次（单次 120 秒）。已完成分块缓存在 `tmp/model-downloads/<sha256>/`，中断后重新执行可续传。最终哈希不符时只清除相应分块缓存，保留已有模型；失败不会创建假模型或输出识别乐谱。官方重定向地址只保存在内存，避免每块重复跳转。

若网络不可达：在能访问这些来源的设备上运行同一命令，校验通过后将 `client/public/models/` 整个目录复制过来，再运行 `npm run models:check`。每个文件必须位于 `<sha256>/<filename>`，不要只放在 models 根目录。完整清单为 `client/src/omr/models.json`，7 个 WASM 模型合计约 190 MB。

如果官方 GitHub 大文件链路较慢，可显式选择公共转发，仅转发公开模型文件 URL，仍强制验证同一个官方 SHA-256；默认不使用第三方转发。本次补齐剩余两个大模型时使用了此设置：

```powershell
$env:OMR_GITHUB_MIRROR='https://gh-proxy.com'
npm run models:download
Remove-Item Env:OMR_GITHUB_MIRROR
```

当前交付目录另有 `puxie-studio-omr-models-0.5.4.zip` 离线模型包及 `.sha256`。需要恢复时解压到 `client/public/models/`，使哈希目录位于 models 下，然后执行 `npm run models:check`。图片、项目和模型缓存没有提交到外部服务。

真实推理回归（需先启动本地应用且模型齐全）：

```powershell
npm run test:omr
npm run test:omr:pages
# 可传入其他本地测试图片
node scripts/smoke-omr.mjs C:/path/to/score.png
node scripts/smoke-omr-pages.mjs C:/path/to/page-1.png C:/path/to/page-2.png
```

默认输入是项目中的测试谱图，成功时保存真实输出 XML、浏览器/模型后端/耗时记录和截图。它验证端到端管线，不保证音符识别正确。

工作台“设置”可检查模型和真实引擎运行时。模型检查会排除 SPA HTML 回退与错误文件大小；引擎推理加载时再次验哈希。固定使用 WASM，缺少跨源隔离时为单线程；原图与推理均在浏览器处理。取消会终止 Worker，过期结果不会覆盖项目。识别成功会创建独立项目并保留完整引擎结果；请逐音符校对，不把识别输出当作已确认正确。

来源：[homr-web](https://github.com/jymen/homr-web)、[其下载脚本](https://github.com/jymen/homr-web/blob/main/tools/download-models.sh)、[MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/)。依赖许可证随各包提供，homr-web 标记为 AGPL-3.0-only。

## 检查

```powershell
npm run piano:check
npm run type:check
npm test
npm run build
npm run test:e2e
# 生产构建的实际浏览器验收
$env:E2E_PRODUCTION='1'
npm run test:e2e
Remove-Item Env:E2E_PRODUCTION
```

Playwright 默认使用已安装的 Chrome。改用 Edge：设置 `PW_BROWSER_CHANNEL=msedge`。不自动下载或安装浏览器。模型缺失路径在 E2E 中显式模拟 404；“真实运行时初始化”测试使用实际 Worker/ONNX/OpenCV，不模拟推理成功。

多页识谱、废纸篓与指法验收见 [docs/MULTIPAGE-VALIDATION.md](docs/MULTIPAGE-VALIDATION.md)。

采样/连梁/高亮验收见 [docs/PIANO-PLAYBACK-VALIDATION.md](docs/PIANO-PLAYBACK-VALIDATION.md)。可运行 `node scripts/smoke-playback.mjs C:/path/to/project.studio.json` 在隔离 Chrome 中复查任意本地谱，默认夹具不含用户项目；输出位于忽略的 `tmp/playback-smoke/`。`APP_URL` 可设置生产预览地址，`PLAYBACK_OUTPUT` 可指定本地输出目录。

最新模型与推理结果见 [docs/OMR-MODEL-RECOVERY.md](docs/OMR-MODEL-RECOVERY.md)，首轮工程验证与已解决失败见 [docs/VALIDATION.md](docs/VALIDATION.md)，变更见 [CHANGELOG.md](CHANGELOG.md)。

## 模块

| 目录                                | 职责                                       |
| ----------------------------------- | ------------------------------------------ |
| `music/score.ts`                    | XML 原文、DOM 和只读投影；能力及保真提示   |
| `music/editor.ts`                   | 定点修改、插入、删除、连线、小节和结构保护 |
| `music/timeline.ts`                 | 播放与 MIDI 共用的拍数、速度、延音时间线   |
| `music/player.ts` / `music/midi.ts` | Web Audio 调度 / SMF 编码                  |
| `components/ScoreView.tsx`          | 实例隔离的 OSMD 排版及精确音符映射         |
| `components/NoteInspector.tsx`      | 音符修正与新声部插入                       |
| `omr/`                              | 同版本模型清单、Worker、预检、取消和错误码 |
| `storage/`                          | XML/MXL/项目文件导入导出、IndexedDB        |
| `tests/`                            | 复杂双手多声部夹具、单元与真实浏览器回归   |

所有路径相对 `client/src/`（`tests/` 位于仓库根目录）。平台模板、Nest 服务、业务通讯录组件、占位图片和无用 UI 依赖已移除；原始基线仍可从 `original-source` 分支恢复。
