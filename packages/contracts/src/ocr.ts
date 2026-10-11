/**
 * OCR 识别文字块单元
 */
export interface OcrBlock {
  /** 文本块唯一标识 */
  id: string;
  /** 归一化或像素坐标边界框 [x, y, width, height] */
  bbox: [number, number, number, number];
  /** 识别出的文本内容 */
  text: string;
  /** 阅读排版顺序编号（0 起始，自然阅读流） */
  readingOrder: number;
  /** 置信度 (0.0 ~ 1.0) */
  confidence?: number;
  /** 所属页面页码（多页 PDF/长图场景） */
  pageNumber?: number;
}

/**
 * OCR 提取请求
 */
export interface OcrRequest {
  /** 请求唯一标识 */
  requestId: string;
  /** 图像数据（Base64 编码字符串或数据资源引用 URI） */
  imageData: string;
  /** 图像 MIME 类型（如 'image/png', 'image/jpeg'） */
  mimeType?: string;
  /** 提示期望的识别语言 */
  sourceLanguage?: string;
}

/**
 * OCR 提取响应
 */
export interface OcrResponse {
  /** 对应请求唯一标识 */
  requestId: string;
  /** 提取的文字块列表（按 readingOrder 或结构编排） */
  blocks: OcrBlock[];
  /** 自动检测到的主导语言 */
  detectedLanguage?: string;
}
