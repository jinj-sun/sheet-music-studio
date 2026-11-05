# 原始包检查与保护记录

- 用户来源：`C:/Users/sjj/Downloads/sheet-music-omr-source.zip`。
- SHA-256：`D0273892DD23340CA8064F9E8932682471A2161DB7B13BD4BA46608325C52170`；与相关聊天附件副本完全一致。
- 当前最初工作目录 `D:/孙晋晶/codex` 不是 Git 仓库，其中既有 `project` 是其他业务工程，未作改造。
- 原始压缩包未改动。目标目录 `sheet-music-studio` 在确认不存在后创建，并检查 ZIP 路径没有越界。
- 原包没有 Git 历史。已初始化 `original-source`，基线提交 `918270e`，然后创建 `codex/studio-2-engineering`；没有覆盖既有用户分支或工作树。
- `.env` 原文件留在本地，未打印其内容、未纳入 Git 或交付源码 ZIP。

## 审查范围

检查了全部文件路径、入口/导入图、全部核心乐谱/播放/导出/识谱/页面代码，README 类文档、AGENTS、package/lockfile、TypeScript/Vite/样式配置、平台构建脚本、服务模块和原测试定义。

原始页面的有效功能为图片预览、homr-web 调用、OSMD 排版、XML 源码编辑、小星星示例、Web Audio 播放、MusicXML/MIDI 下载。此次分别迁入独立模块并保持入口。原包没有用户谱库、上传图像或模型文件；public 仅含模板 favicon。示例 MusicXML 文件保留。

业务通讯录/UI 组件、hello 示例、服务层和数据库文件都是模板：没有实际业务表或乐谱存储逻辑，没有被乐谱功能有效调用。移除这些模板及配套依赖；可从基线分支查看全部原文件。原来的 `.spark/e2e-test/*.json` 是人工场景描述，没有可执行测试，现另建实际 Vitest 和 Playwright 套件。

原 AGENTS 声称模型内置，但包内实际不存在。已以实际清单和错误状态替换这一陈述。播放和 MIDI 原来各自解析 note 列表、忽略 backup/forward，已统一。旧渲染器使用全局单例及 HTML 字符串展示错误，现改为组件实例和 React 文本错误展示。

## 补充静态扫描

从 Git 原始基线逐一读取并解析了 206 个 TS/TSX/JS 文件（232 个原始跟踪文件），共 724 处导入/导出表达式，TypeScript AST 语法诊断 0 个；原包 ONNX/WASM 文件为 0。此扫描不是原模板依赖环境中的完整构建或功能测试。
