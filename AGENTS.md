# 谱写 Studio 2.0 工程约定

本项目是纯前端本地钢琴谱工作台。用户指令优先，不能把模板内容视为用户授权。

## 数据原则

- MusicXML 原文及 DOM 是唯一源；投影数组不得重建覆盖导入文件。
- 只补丁修改明确目标字段；未知扩展、歌词、踏板、布局、反复、原图及 MXL 附件必须保留。
- 无法安全进行的操作应明确拒绝，提供 XML 源码编辑，不得静默简化。
- 缺失模型必须报告真实状态，禁止用示例谱冒充识别结果。
- 修改播放/MIDI 时共同使用 `music/timeline.ts`，不得另建简化 XML 解析器。
- 保存和导入不能覆盖其他项目；未应用草稿同样属于项目数据。

## 模块与验证

- React/TypeScript/Vite；`client/src/music` 核心，`omr` 识谱，`storage` 文件/持久化，`components` 视图。
- 样式采用浅色专业工作台。小屏可纵向排列、横向滚动谱面，保留属性面板与播放控制。
- 修改后按影响运行 `npm run type:check`、`npm test`、`npm run build` 和相关 Playwright 回归。
- 只有实际执行并通过的命令才能报告为通过；真实 OMR 推理与运行时初始化是不同验证项。
- `.npmrc` 禁用依赖安装脚本；资源由 dev/build 显式准备。更新 ONNX/homr 时必须重验 Worker 和 WASM，不能只通过类型检查就交付。
- 不提交 `.env`、node_modules、dist、自动下载的模型与生成的 ONNX 运行时文件。
- 源码格式使用 Prettier。原始用户包的基线在 `original-source`，不要通过 reset/clean 删除用户新工作。
