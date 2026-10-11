import type {
  TranslationRequest,
  TranslationResponse,
  TranslationProviderConfig,
  TranslationSegmentResult,
} from '@translate/contracts';
import { assertTranslationAlignment } from '@translate/contracts';
import type { TranslationProvider } from './types';

// 常用英语段落/句式对照字典，提供逼真的离线演示体验
const KNOWN_TRANSLATIONS: Record<string, string> = {
  'Hello, world!': '你好，世界！',
  'Hello world': '你好，世界',
  'Welcome to the bilingual browser translation tutorial.': '欢迎使用双语浏览器翻译教程。',
  'In this session, we demonstrate real-time offline speech recognition.': '在本节中，我们演示实时离线语音识别。',
  'Timestamps and audio cues remain aligned throughout media playback.': '在整个媒体播放过程中，时间戳与音频提示均保持严格对齐。',
  'This is a cross-platform browser translation extension built with Manifest V3 and WXT.':
    '这是一个采用 Manifest V3 与 WXT 构建的跨平台浏览器翻译扩展。',
  'Offline translation guarantees complete data privacy by keeping all processing on-device.':
    '离线翻译通过在设备本地完成所有计算处理，确保完整的数据隐私。',
  'Both text PDF files and scanned image documents can be parsed through reading order layout reconstruction.':
    '通过阅读顺序排版重构，纯文本 PDF 和扫描图像文档均可被精确解析。',
  'Offline document processing keeps intellectual property and sensitive corporate data within local boundaries.':
    '离线文档处理将企业知识产权和敏感商业数据严格保留在本地边界之内。',
  'Features': '特性概览',
  'Overview': '概述',
  'Getting Started': '快速入门',
  'Installation': '安装指南',
  'Configuration': '配置说明',
  'Architecture': '系统架构',
  'Usage': '使用方法',
  'Documentation': '开发文档',
  'Read more': '阅读更多',
  'Submit': '提交',
  'Cancel': '取消',
};

// 常见英文词汇快速映射表
const COMMON_WORD_MAP: Record<string, string> = {
  browser: '浏览器',
  translation: '翻译',
  extension: '扩展插件',
  plugin: '插件',
  document: '文档',
  paragraph: '段落',
  video: '视频',
  subtitle: '字幕',
  offline: '离线',
  model: '模型',
  local: '本地',
  cloud: '云端',
  network: '网络',
  data: '数据',
  privacy: '隐私',
  security: '安全',
  service: '服务',
  system: '系统',
  fast: '快速',
  smart: '智能',
  bilingual: '双语',
  reader: '阅读器',
  page: '页面',
  content: '内容',
  device: '设备',
  runtime: '运行时',
};

function generateMockTranslation(text: string, targetLang: string): string {
  const trimmed = text.trim();
  if (KNOWN_TRANSLATIONS[trimmed]) {
    return KNOWN_TRANSLATIONS[trimmed];
  }

  // 若目标语言不是中文，生成可辨识的模拟译文
  if (!targetLang.toLowerCase().startsWith('zh')) {
    return `[${targetLang}] ${trimmed}`;
  }

  // 中文模拟智能翻译逻辑
  // 检查是否包含英文常见词汇
  let translated = trimmed;
  let replacedCount = 0;
  for (const [en, zh] of Object.entries(COMMON_WORD_MAP)) {
    const reg = new RegExp(`\\b${en}\\b`, 'gi');
    if (reg.test(translated)) {
      translated = translated.replace(reg, zh);
      replacedCount++;
    }
  }

  if (replacedCount > 0) {
    return `[译] ${translated}`;
  }

  // 纯中文句子无需重译
  if (/^[\u4e00-\u9fa5\s，。！？、“”《》（）]+$/.test(trimmed)) {
    return `（已为中文）${trimmed}`;
  }

  // 默认平滑译文格式
  return `[译] ${trimmed}`;
}

export class MockProvider implements TranslationProvider {
  public readonly config: TranslationProviderConfig;
  private readonly delayMs: number;

  constructor(config: TranslationProviderConfig, delayMs: number = 100) {
    this.config = config;
    this.delayMs = delayMs;
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResponse> {
    if (signal?.aborted) {
      throw new Error('Translation aborted by caller');
    }

    const startTime = performance.now();

    // 模拟真实异步计算/I/O延迟
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Translation aborted'));
          });
        }
      });
    }

    const results: TranslationSegmentResult[] = request.segments.map((segment) => ({
      id: segment.id,
      translation: generateMockTranslation(segment.text, request.targetLanguage),
    }));

    const response: TranslationResponse = {
      requestId: request.requestId,
      segments: results,
      resolvedEngine: {
        id: this.config.model || 'mock-engine-v1',
        revision: `mock-rev-${this.config.revision || 1}`,
        actualLocation: 'local',
      },
      metrics: {
        durationMs: Math.round(performance.now() - startTime),
        promptTokens: request.segments.reduce((acc, s) => acc + s.text.length, 0),
        completionTokens: results.reduce((acc, s) => acc + s.translation.length, 0),
        cacheHit: false,
      },
    };

    // 校验严格对齐
    assertTranslationAlignment(request, response);

    return response;
  }

  async testConnection(signal?: AbortSignal): Promise<{ durationMs: number; sampleTranslation: string }> {
    const testReq: TranslationRequest = {
      requestId: 'test-conn-' + Date.now(),
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'test-1', text: 'Hello, world!' }],
    };

    const res = await this.translate(testReq, signal);
    return {
      durationMs: res.metrics?.durationMs || 50,
      sampleTranslation: res.segments[0]?.translation || '你好，世界！',
    };
  }
}
