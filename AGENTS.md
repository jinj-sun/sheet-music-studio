# 钢琴谱识别与编辑工具

## 应用概述
纯前端浏览器应用，用户上传乐谱图片 → 本地 OMR 识别 → 渲染乐谱支持编辑 → 导出 MusicXML / MIDI。
识别内核使用 homr-web（基于 onnxruntime-web，WASM 模式运行）。

## 技术架构
- **前端框架**: React 19 + TypeScript + Vite
- **样式**: Tailwind CSS
- **OMR 引擎**: homr-web v0.5.4（浏览器本地运行，显式指定 WASM 模式）
- **乐谱渲染**: opensheetmusicdisplay (OSMD)
- **MIDI 导出**: midi-writer-js（解析 MusicXML 生成 MIDI）
- **模型文件**: 内置在 `client/public/models/` 下，运行时 baseUrl 基于 `window.location.href` 计算

## 页面结构
单页应用（`/` 路由），三阶段状态：
1. **上传阶段** - 拖拽/选择图片，原图预览，支持加载示例乐谱
2. **识别阶段** - 进度显示（模型加载、识别各阶段），可取消
3. **编辑阶段** - 三 Tab：乐谱渲染视图 / XML 源码编辑 / 原图对照，支持播放试听和导出

### 播放试听功能
- 控制栏：播放/暂停/停止按钮、进度条、速度滑块（40-200 BPM）、音量滑块
- 音频合成：Web Audio API 合成钢琴音色（多谐波 + ADSR 包络），双声部独立发声
- 进度跟随：OSMD Cursor 光标高亮当前播放位置
- 修改联动：XML 源码修改并应用后，播放器自动重新解析更新

## 核心模块
- `src/utils/homrRecognizer.ts` - homr-web 识别器封装
- `src/utils/osmdRenderer.ts` - OSMD 乐谱渲染器封装（含播放光标控制）
- `src/utils/musicPlayer.ts` - 音乐播放器（Web Audio 钢琴音色合成 + 音符调度）
- `src/utils/exportUtils.ts` - MusicXML 和 MIDI 导出工具
- `src/utils/sampleMusicXml.ts` - 示例乐谱（小星星）
- `src/pages/SheetMusic/SheetMusicPage.tsx` - 主页面

## 设计规范
- 布局：顶部工具栏 + 主内容区（居中卡片式）
- 颜色：深色主题（slate-900 背景），钢琴键黑白配色为主，indigo-500 强调色
- 间距：内容区 padding 24px，卡片间距 16px
- 字体：系统无衬线字体，标题 text-xl font-semibold，正文 text-base

## 已知限制
- 显式使用 WASM 后端（WebGPU 需 fp16 模型未内置），识别速度约 60-120 秒/页
- 编辑采用 XML 源码编辑方式，修改后点击应用变更重新渲染
- MIDI 导出基于 MusicXML 解析，复杂谱表（多声部、连音线等）可能不完整
