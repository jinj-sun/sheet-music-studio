import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Play, Music, FileText, Download, RotateCcw, Loader2, Image as ImageIcon, AlertCircle, CheckCircle2, Pause, Square, Volume2 } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Progress } from '@client/src/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@client/src/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { Badge } from '@client/src/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@client/src/components/ui/alert';
import { Slider } from '@client/src/components/ui/slider';

import type { RecognizerProgress, RecognitionResult, RecognitionSuccess, RecognitionFailure } from '@/utils/homrRecognizer';
import { createRecognizer, disposeRecognizer, recognizeImage } from '@/utils/homrRecognizer';
import { renderMusicXml, cleanupRenderer, enableCursor, disableCursor, resetCursor, advanceCursor, isCursorEnabled } from '@/utils/osmdRenderer';
import { exportMusicXml, exportMidi } from '@/utils/exportUtils';
import { SAMPLE_MUSICXML } from '@/utils/sampleMusicXml';
import { Image } from '@client/src/components/ui/image';
import { MusicPlayer } from '@/utils/musicPlayer';

type Stage = 'upload' | 'recognizing' | 'editing';

const STAGE_LABELS: Record<string, string> = {
  models: '加载模型',
  segment: '图像分割',
  detect: '音符检测',
  dewarp: '谱线校正',
  staff: '五线谱识别',
  ocr: '文字识别',
  xml: '生成 MusicXML',
  tab: '指法谱检测',
};

const SheetMusicPage = () => {
  const [stage, setStage] = useState<Stage>('upload');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [progressStage, setProgressStage] = useState<string>('');
  const [progressValue, setProgressValue] = useState<number>(0);
  const [musicXml, setMusicXml] = useState<string>('');
  const [xmlEditorValue, setXmlEditorValue] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [backend, setBackend] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [tempo, setTempo] = useState(100);
  const [volume, setVolume] = useState(0.6);

  const osmdContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<MusicPlayer | null>(null);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件（PNG、JPG 等）');
      return;
    }
    setError('');
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setMusicXml('');
    setXmlEditorValue('');
    setStage('upload');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const startRecognition = useCallback(async () => {
    if (!imageFile) return;
    setStage('recognizing');
    setRecognizing(true);
    setError('');
    setProgressValue(0);
    setProgressStage('初始化');

    abortControllerRef.current = new AbortController();

    try {
      const modelsUrl = `${window.location.origin}${import.meta.env.BASE_URL}models/`;
      await createRecognizer(modelsUrl);

      const onProgress = (p: RecognizerProgress) => {
        setProgressStage(STAGE_LABELS[p.stage] || p.stage);
        if (p.total > 0) {
          setProgressValue(Math.round((p.done / p.total) * 100));
        }
      };

      const result: RecognitionResult = await recognizeImage(
        imageFile,
        onProgress,
        abortControllerRef.current.signal
      );

      const { recognizerBackend } = await import('@/utils/homrRecognizer').then(m => ({
        recognizerBackend: m.getBackend(),
      }));
      setBackend(recognizerBackend);

      if ((result as RecognitionSuccess).ok) {
        const success = result as RecognitionSuccess;
        setMusicXml(success.musicXml);
        setXmlEditorValue(success.musicXml);
        setStage('editing');
      } else {
        const failure = result as RecognitionFailure;
        setError(`识别失败：${failure.error}\n${failure.log || ''}`);
        setStage('upload');
      }
    } catch (err) {
      logger.error('识别出错', err);
      setError(err instanceof Error ? err.message : '未知错误');
      setStage('upload');
    } finally {
      setRecognizing(false);
    }
  }, [imageFile]);

  const cancelRecognition = useCallback(() => {
    abortControllerRef.current?.abort();
    setStage('upload');
    setRecognizing(false);
  }, []);

  const applyXmlChanges = useCallback(() => {
    setMusicXml(xmlEditorValue);
  }, [xmlEditorValue]);

  const loadSample = useCallback(() => {
    setMusicXml(SAMPLE_MUSICXML);
    setXmlEditorValue(SAMPLE_MUSICXML);
    setStage('editing');
    setError('');
    setBackend('示例');
  }, []);

  const resetAll = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current.dispose();
      playerRef.current = null;
    }
    disableCursor();
    setIsPlaying(false);
    setPlayProgress(0);
    setStage('upload');
    setImageFile(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl('');
    setMusicXml('');
    setXmlEditorValue('');
    setError('');
    setProgressValue(0);
    setBackend('');
    cleanupRenderer();
    disposeRecognizer();
  }, [imageUrl]);

  useEffect(() => {
    if (stage === 'editing' && musicXml && osmdContainerRef.current) {
      renderMusicXml(musicXml, osmdContainerRef.current).catch((err) => {
        logger.error('渲染乐谱失败', err);
        setError(`乐谱渲染失败：${err.message}`);
      });

      if (!playerRef.current) {
        playerRef.current = new MusicPlayer();
      }
      try {
        playerRef.current.loadMusic(musicXml);
        playerRef.current.setOptions({
          tempo,
          volume,
          onProgress: (current, total) => {
            if (total > 0) {
              setPlayProgress((current / total) * 100);
            }
          },
          onEntryChange: () => {
            if (!isCursorEnabled()) {
              enableCursor();
            }
            advanceCursor();
          },
          onEnd: () => {
            setIsPlaying(false);
          },
        });
      } catch (err) {
        logger.error('加载乐谱到播放器失败', err);
      }
    }
    return () => {
      if (playerRef.current) {
        playerRef.current.stop();
      }
      disableCursor();
      setIsPlaying(false);
    };
  }, [stage, musicXml]);

  useEffect(() => {
    return () => {
      disposeRecognizer();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      if (playerRef.current) {
        playerRef.current.dispose();
      }
    };
  }, [imageUrl]);

  const handlePlayPause = useCallback(() => {
    if (!playerRef.current) return;

    if (isPlaying) {
      playerRef.current.pause();
      setIsPlaying(false);
    } else {
      const currentTime = playerRef.current.getCurrentTime();
      const total = playerRef.current.getTotalDuration();
      let startOffset = currentTime;
      if (currentTime >= total) {
        startOffset = 0;
      }

      const entryIdx = playerRef.current.getEntryIndexByTime(startOffset);
      resetCursor();
      if (!isCursorEnabled()) {
        enableCursor();
      }
      for (let i = 0; i < entryIdx; i++) {
        advanceCursor();
      }

      playerRef.current.play(startOffset);
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleStop = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.stop();
    if (isCursorEnabled()) {
      resetCursor();
    }
    setIsPlaying(false);
    setPlayProgress(0);
  }, []);

  const handleTempoChange = useCallback((value: number[]) => {
    const newTempo = value[0];
    setTempo(newTempo);
    if (playerRef.current) {
      playerRef.current.setOptions({ tempo: newTempo });
    }
  }, []);

  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (playerRef.current) {
      playerRef.current.setOptions({ volume: newVolume });
    }
  }, []);

  const handleExportMusicXml = () => {
    exportMusicXml(musicXml, 'sheet_music.xml');
  };

  const handleExportMidi = async () => {
    try {
      await exportMidi(musicXml, 'sheet_music.mid');
    } catch (err) {
      logger.error('MIDI 导出失败', err);
      setError(`MIDI 导出失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Music className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">钢琴谱识别工具</h1>
              <p className="text-xs text-slate-400">OMR 光学乐谱识别 · 本地运行</p>
            </div>
          </div>
          {stage === 'editing' && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={resetAll}>
                <RotateCcw className="w-4 h-4 mr-2" />
                重新开始
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportMusicXml}>
                <FileText className="w-4 h-4 mr-2" />
                导出 MusicXML
              </Button>
              <Button size="sm" onClick={handleExportMidi}>
                <Download className="w-4 h-4 mr-2" />
                导出 MIDI
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6 bg-red-950/50 border-red-800">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        )}

        {stage === 'upload' && (
          <div className="grid md:grid-cols-2 gap-8">
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-xl">上传乐谱图片</CardTitle>
                <CardDescription className="text-slate-400">
                  支持 PNG、JPG 等格式，识别过程完全在浏览器本地运行
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${
                    isDragging
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/50'
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                  />
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
                    <Upload className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-slate-300 font-medium mb-1">
                    拖拽图片到这里，或点击选择文件
                  </p>
                  <p className="text-sm text-slate-500">
                    支持 PNG、JPG、JPEG、WebP 等格式
                  </p>
                  <p className="text-xs text-slate-600 mt-3">
                    没有乐谱图片？
                    <button
                      type="button"
                      className="text-indigo-400 hover:text-indigo-300 underline ml-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        loadSample();
                      }}
                    >
                      加载示例乐谱体验
                    </button>
                  </p>
                </div>

                {imageFile && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span>已选择：{imageFile.name}</span>
                      <Badge variant="outline" className="ml-auto text-xs border-slate-700">
                        {(imageFile.size / 1024 / 1024).toFixed(1)} MB
                      </Badge>
                    </div>
                    <Button
                      className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500"
                      onClick={startRecognition}
                      size="lg"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      开始识别
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  原图预览
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl overflow-hidden bg-slate-950 min-h-[400px] flex items-center justify-center border border-slate-800">
                  {imageUrl ? (
                    <Image
                      src={imageUrl}
                      alt="乐谱预览"
                      className="max-w-full max-h-[500px] object-contain"
                    />
                  ) : (
                    <div className="text-slate-600 text-center py-16">
                      <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>上传后将在这里显示原图</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {stage === 'recognizing' && (
          <Card className="bg-slate-900/50 border-slate-800 max-w-2xl mx-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-3 text-lg">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                  正在识别乐谱
                </CardTitle>
                <CardDescription className="text-slate-400 mt-1">
                  浏览器本地运行，无需上传到服务器
                </CardDescription>
              </div>
              {backend && (
                <Badge variant="outline" className="border-slate-700 text-slate-400 shrink-0">
                  后端：{backend}
                </Badge>
              )}
            </div>
            <CardContent className="space-y-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-300">{progressStage}</span>
                  <span className="text-slate-400">{progressValue}%</span>
                </div>
                <Progress value={progressValue} className="h-2 bg-slate-800" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {['models', 'segment', 'detect', 'staff', 'ocr', 'xml'].map((s) => (
                  <div
                    key={s}
                    className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
                      progressStage === STAGE_LABELS[s]
                        ? 'bg-indigo-500/20 border border-indigo-500/50 text-indigo-300'
                        : progressValue > 0 && STAGE_LABELS[s] < progressStage
                        ? 'bg-emerald-950/30 border border-emerald-800/50 text-emerald-400'
                        : 'bg-slate-800/50 border border-slate-700/50 text-slate-500'
                    }`}
                  >
                    {progressStage === STAGE_LABELS[s] ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-current" />
                    )}
                    {STAGE_LABELS[s] || s}
                  </div>
                ))}
              </div>

              <Button variant="ghost" className="w-full" onClick={cancelRecognition}>
                取消识别
              </Button>
            </CardContent>
          </Card>
        )}

        {stage === 'editing' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge className="bg-emerald-600 hover:bg-emerald-700">识别完成</Badge>
                <Badge variant="outline" className="border-slate-700 text-slate-400">
                  后端：{backend}
                </Badge>
              </div>
            </div>

            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">乐谱预览与编辑</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-10 h-10 p-0"
                        onClick={handlePlayPause}
                        aria-label={isPlaying ? '暂停' : '播放'}
                      >
                        {isPlaying ? (
                          <Pause className="w-5 h-5" />
                        ) : (
                          <Play className="w-5 h-5 ml-0.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-10 h-10 p-0"
                        onClick={handleStop}
                        aria-label="停止"
                      >
                        <Square className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex-1">
                      <Progress value={playProgress} className="h-2 bg-slate-800" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400 min-w-[80px]">
                      <Volume2 className="w-4 h-4" />
                      <div className="w-16">
                        <Slider
                          value={[volume]}
                          max={1}
                          step={0.05}
                          onValueChange={handleVolumeChange}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span className="shrink-0">速度</span>
                      <div className="w-20">
                        <Slider
                          value={[tempo]}
                          min={40}
                          max={200}
                          step={5}
                          onValueChange={handleTempoChange}
                        />
                      </div>
                      <span className="w-10 text-right">{tempo}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    点击播放按钮试听乐谱，播放时光标会跟随当前音符位置
                  </p>
                </div>

                <Tabs defaultValue="score" className="w-full">
                  <TabsList className="mb-4 bg-slate-800">
                    <TabsTrigger value="score" className="data-[state=active]:bg-slate-700">
                      乐谱视图
                    </TabsTrigger>
                    <TabsTrigger value="xml" className="data-[state=active]:bg-slate-700">
                      XML 源码编辑
                    </TabsTrigger>
                    <TabsTrigger value="original" className="data-[state=active]:bg-slate-700">
                      原图对照
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="score">
                    <div
                      ref={osmdContainerRef}
                      className="w-full min-h-[500px] bg-white rounded-lg p-4 overflow-x-auto"
                    >
                      <p className="text-slate-400 text-center py-8">正在渲染乐谱...</p>
                    </div>
                  </TabsContent>
                  <TabsContent value="xml">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <p className="text-sm text-slate-400">
                          直接编辑 MusicXML 源码，点击应用修改后重新渲染
                        </p>
                        <Button size="sm" onClick={applyXmlChanges}>
                          应用修改
                        </Button>
                      </div>
                      <textarea
                        value={xmlEditorValue}
                        onChange={(e) => setXmlEditorValue(e.target.value)}
                        className="w-full h-[500px] font-mono text-xs bg-slate-950 text-slate-300 p-4 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none resize-none"
                        spellCheck={false}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="original">
                    <div className="bg-slate-950 rounded-lg p-4 flex justify-center min-h-[500px]">
                      {imageUrl && (
                        <Image
                          src={imageUrl}
                          alt="原乐谱"
                          className="max-w-full max-h-[600px] object-contain"
                        />
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800 mt-16 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center text-sm text-slate-500">
          <p>识别引擎：homr-web · 所有计算在您的浏览器本地完成，不上传任何图片</p>
        </div>
      </footer>
    </div>
  );
};

export default SheetMusicPage;
