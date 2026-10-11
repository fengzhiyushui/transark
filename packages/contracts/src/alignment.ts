import { ErrorCode, AppError } from './error.js';
import type {
  TranslationRequest,
  TranslationResponse,
  TranslationSegmentResult,
} from './translation.js';

export interface AlignmentMismatchDetail {
  type: 'DUPLICATE_REQUEST_ID' | 'DUPLICATE_RESPONSE_ID' | 'MISSING_SEGMENT' | 'EXTRA_SEGMENT' | 'REQUEST_ID_MISMATCH';
  message: string;
  segmentIds?: string[];
}

export interface TranslationAlignmentValidationResult {
  valid: boolean;
  errors: AlignmentMismatchDetail[];
}

/**
 * 校验翻译请求与响应的段落 ID 是否严格对齐
 * 规则：
 * 1. requestId 必须匹配
 * 2. 响应段落 ID 不能重复
 * 3. 响应段落不得遗漏请求中的任何 ID
 * 4. 响应段落不得包含请求中未出现过的未知 ID
 */
export function validateTranslationAlignment(
  request: TranslationRequest,
  response: TranslationResponse
): TranslationAlignmentValidationResult {
  const errors: AlignmentMismatchDetail[] = [];

  if (request.requestId !== response.requestId) {
    errors.push({
      type: 'REQUEST_ID_MISMATCH',
      message: `RequestId mismatch: expected "${request.requestId}", got "${response.requestId}"`,
    });
  }

  // 检查请求段落 ID 唯一性
  const reqIdSet = new Set<string>();
  const duplicateReqIds = new Set<string>();
  for (const seg of request.segments) {
    if (reqIdSet.has(seg.id)) {
      duplicateReqIds.add(seg.id);
    }
    reqIdSet.add(seg.id);
  }
  if (duplicateReqIds.size > 0) {
    errors.push({
      type: 'DUPLICATE_REQUEST_ID',
      message: `Request contains duplicate segment IDs: ${Array.from(duplicateReqIds).join(', ')}`,
      segmentIds: Array.from(duplicateReqIds),
    });
  }

  // 检查响应段落 ID 唯一性与未知 ID
  const respIdSet = new Set<string>();
  const duplicateRespIds = new Set<string>();
  const extraIds = new Set<string>();

  for (const seg of response.segments) {
    if (respIdSet.has(seg.id)) {
      duplicateRespIds.add(seg.id);
    }
    respIdSet.add(seg.id);

    if (!reqIdSet.has(seg.id)) {
      extraIds.add(seg.id);
    }
  }

  if (duplicateRespIds.size > 0) {
    errors.push({
      type: 'DUPLICATE_RESPONSE_ID',
      message: `Response contains duplicate segment IDs: ${Array.from(duplicateRespIds).join(', ')}`,
      segmentIds: Array.from(duplicateRespIds),
    });
  }

  if (extraIds.size > 0) {
    errors.push({
      type: 'EXTRA_SEGMENT',
      message: `Response contains unknown segment IDs not in request: ${Array.from(extraIds).join(', ')}`,
      segmentIds: Array.from(extraIds),
    });
  }

  // 检查缺失的 ID
  const missingIds: string[] = [];
  for (const id of reqIdSet) {
    if (!respIdSet.has(id)) {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    errors.push({
      type: 'MISSING_SEGMENT',
      message: `Response is missing segment IDs from request: ${missingIds.join(', ')}`,
      segmentIds: missingIds,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 断言严格对齐，若不对齐则抛出 AppError(ErrorCode.ALIGNMENT_MISMATCH)
 */
export function assertTranslationAlignment(
  request: TranslationRequest,
  response: TranslationResponse
): void {
  const result = validateTranslationAlignment(request, response);
  if (!result.valid) {
    const errorMsg = result.errors.map((e) => e.message).join('; ');
    throw new AppError(
      ErrorCode.ALIGNMENT_MISMATCH,
      `Translation alignment check failed: ${errorMsg}`,
      { validationErrors: result.errors }
    );
  }
}

/**
 * 按照请求中的原始段落顺序，重排或安全规范化响应段落结果列表
 */
export function alignTranslationResults(
  request: TranslationRequest,
  response: TranslationResponse
): TranslationSegmentResult[] {
  const respMap = new Map<string, TranslationSegmentResult>();
  for (const item of response.segments) {
    respMap.set(item.id, item);
  }

  return request.segments.map((seg) => {
    const found = respMap.get(seg.id);
    if (found) {
      return found;
    }
    // 若某个段落缺失，自动补齐错误项而非直接崩溃
    return {
      id: seg.id,
      translation: '',
      error: {
        code: ErrorCode.ALIGNMENT_MISMATCH,
        message: `Missing segment in provider response for ID: ${seg.id}`,
      },
    };
  });
}
