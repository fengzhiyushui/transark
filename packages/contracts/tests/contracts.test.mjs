import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ErrorCode,
  AppError,
  isAppError,
  createAppError,
  validateTranslationAlignment,
  assertTranslationAlignment,
  alignTranslationResults,
  JobStatus,
  isJobTerminal,
  isJobActive,
  mockTranslationRequest,
  mockTranslationResponse,
  mockTranslationProviderConfigs,
  mockOcrBlocks,
  mockOcrResponse,
  mockAsrCues,
  mockAsrResponse,
  mockJobProgressCompleted,
  mockFileTranslationJob,
} from '../dist/index.js';

test('ErrorCode and AppError', () => {
  assert.equal(ErrorCode.AUTH_FAILED, 'AUTH_FAILED');
  assert.equal(ErrorCode.NETWORK_ERROR, 'NETWORK_ERROR');
  assert.equal(ErrorCode.RATE_LIMITED, 'RATE_LIMITED');
  assert.equal(ErrorCode.MODEL_UNAVAILABLE, 'MODEL_UNAVAILABLE');
  assert.equal(ErrorCode.TIMEOUT, 'TIMEOUT');
  assert.equal(ErrorCode.POLICY_VIOLATION, 'POLICY_VIOLATION');
  assert.equal(ErrorCode.ALIGNMENT_MISMATCH, 'ALIGNMENT_MISMATCH');

  const err = createAppError(ErrorCode.AUTH_FAILED, 'Invalid token', { profileId: 'test' });
  assert.ok(isAppError(err));
  assert.equal(err.code, ErrorCode.AUTH_FAILED);
  assert.equal(err.message, 'Invalid token');
  assert.deepEqual(err.details, { profileId: 'test' });
});

test('Strict translation alignment validation with mock data', () => {
  // 1. Mock request and response should pass validation perfectly
  const result = validateTranslationAlignment(mockTranslationRequest, mockTranslationResponse);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);

  // assertTranslationAlignment should not throw
  assert.doesNotThrow(() => {
    assertTranslationAlignment(mockTranslationRequest, mockTranslationResponse);
  });
});

test('Alignment validation detects mismatched or missing IDs', () => {
  const badResponse = {
    requestId: mockTranslationRequest.requestId,
    segments: [
      { id: 'seg-1', translation: '你好' },
      { id: 'seg-unknown', translation: '未知' }, // unknown segment
      // missing seg-2 and seg-3
    ],
  };

  const validation = validateTranslationAlignment(mockTranslationRequest, badResponse);
  assert.equal(validation.valid, false);

  const errorTypes = validation.errors.map((e) => e.type);
  assert.ok(errorTypes.includes('EXTRA_SEGMENT'));
  assert.ok(errorTypes.includes('MISSING_SEGMENT'));

  assert.throws(
    () => {
      assertTranslationAlignment(mockTranslationRequest, badResponse);
    },
    (err) => err instanceof AppError && err.code === ErrorCode.ALIGNMENT_MISMATCH
  );
});

test('alignTranslationResults fills fallback for missing segments', () => {
  const partialResponse = {
    requestId: mockTranslationRequest.requestId,
    segments: [
      { id: 'seg-2', translation: '段落2译文' },
      { id: 'seg-1', translation: '段落1译文' },
    ],
  };

  const aligned = alignTranslationResults(mockTranslationRequest, partialResponse);
  assert.equal(aligned.length, mockTranslationRequest.segments.length);
  assert.equal(aligned[0].id, 'seg-1');
  assert.equal(aligned[0].translation, '段落1译文');
  assert.equal(aligned[1].id, 'seg-2');
  assert.equal(aligned[1].translation, '段落2译文');
  assert.equal(aligned[2].id, 'seg-3');
  assert.equal(aligned[2].error?.code, ErrorCode.ALIGNMENT_MISMATCH);
});

test('JobStatus and helpers', () => {
  assert.equal(JobStatus.PENDING, 'pending');
  assert.equal(JobStatus.PROCESSING, 'processing');
  assert.equal(JobStatus.COMPLETED, 'completed');
  assert.equal(JobStatus.FAILED, 'failed');
  assert.equal(JobStatus.CANCELLED, 'cancelled');

  assert.equal(isJobTerminal(JobStatus.COMPLETED), true);
  assert.equal(isJobTerminal(JobStatus.FAILED), true);
  assert.equal(isJobTerminal(JobStatus.CANCELLED), true);
  assert.equal(isJobTerminal(JobStatus.PENDING), false);
  assert.equal(isJobTerminal(JobStatus.PROCESSING), false);

  assert.equal(isJobActive(JobStatus.PENDING), true);
  assert.equal(isJobActive(JobStatus.PROCESSING), true);
  assert.equal(isJobActive(JobStatus.COMPLETED), false);
});

test('Mock provider configs use API access only', () => {
  const cloud = mockTranslationProviderConfigs.find((c) => c.profileId === 'cloud-openai-byok');
  assert.ok(cloud);
  assert.equal(cloud.dataPolicy, 'allow-cloud');
  assert.equal(cloud.processingLocation, 'cloud');

  const lan = mockTranslationProviderConfigs.find((c) => c.profileId === 'lan-self-hosted-gateway');
  assert.ok(lan);
  assert.equal(lan.dataPolicy, 'allow-lan');
  assert.equal(lan.processingLocation, 'lan');

  // 本地接入模式已移除：不应再存在指向回环的 device-only Profile
  assert.equal(
    mockTranslationProviderConfigs.some((c) => c.dataPolicy === 'device-only'),
    false
  );
});

test('Mock OCR, ASR and Job models', () => {
  assert.ok(mockOcrBlocks.length > 0);
  assert.equal(mockOcrBlocks[0].bbox.length, 4);
  assert.equal(typeof mockOcrBlocks[0].readingOrder, 'number');

  assert.ok(mockAsrCues.length > 0);
  assert.ok(mockAsrCues[0].endTime > mockAsrCues[0].startTime);

  assert.equal(mockFileTranslationJob.status, JobStatus.COMPLETED);
  assert.equal(mockJobProgressCompleted.status, JobStatus.COMPLETED);
});
