"""契约 mock 数据（与 packages/contracts/src/mock.ts 逐字段对齐）。

这些数据同时用于：
1. 验证 Pydantic 模型与 TypeScript contracts 的字段一致性；
2. 作为 /v1/translate 的 mock 样本（内置引擎对相同文本返回契约 mock 译文）。
"""

from __future__ import annotations

# 与 mock.ts 的 mockTranslationRequest / mockTranslationResponse 对齐
MOCK_TRANSLATION_REQUEST = {
    "requestId": "req-mock-trans-001",
    "sourceLanguage": "en",
    "targetLanguage": "zh-CN",
    "segments": [
        {
            "id": "seg-1",
            "text": "Hello, world!",
            "context": "Page title header",
        },
        {
            "id": "seg-2",
            "text": "This is a cross-platform browser translation extension built with Manifest V3 and WXT.",
            "context": "Introduction paragraph",
        },
        {
            "id": "seg-3",
            "text": "Offline translation guarantees complete data privacy by keeping all processing on-device.",
            "context": "Privacy declaration footnote",
        },
    ],
    "profileId": "local-ollama-qwen",
    "revision": 1,
    "options": {
        "temperature": 0.2,
        "format": "text",
        "preserveTerminology": True,
    },
}

# 内置混合引擎对这些原文返回契约 mock 译文
MOCK_TRANSLATION_EXPECTED = {
    "seg-1": "你好，世界！",
    "seg-2": "这是一个采用 Manifest V3 与 WXT 构建的跨平台浏览器翻译扩展。",
    "seg-3": "离线翻译通过在设备本地完成所有计算处理，确保完整的数据隐私。",
}

# 与 mock.ts 的 mockLocalCompanionConfig 对齐（device-only 本地伴随服务）
MOCK_LOCAL_COMPANION_CONFIG = {
    "profileId": "local-companion-service",
    "revision": 1,
    "name": "Local Companion Service (Loopback)",
    "protocol": "custom-translate",
    "baseUrl": "http://127.0.0.1:8765/v1",
    "model": "built-in-hybrid",
    "auth": {"type": "bearer", "secretRef": "local-companion-pairing-token"},
    "dataPolicy": "device-only",
    "deploymentLocation": "loopback",
    "processingLocation": "local",
    "capabilities": {
        "textTranslation": True,
        "ocr": True,
        "asr": True,
        "timestamps": True,
        "streaming": True,
        "structuredOutput": True,
        "asyncJobs": True,
    },
    "limits": {
        "maxBatchSize": 100,
        "maxInputLength": 16000,
        "concurrency": 4,
        "timeoutMs": 30000,
    },
    "isDefault": True,
    "enabled": True,
}

# 与 mock.ts 的 mockOcrBlocks 对齐
MOCK_OCR_BLOCKS = [
    {
        "id": "ocr-block-001",
        "bbox": [32, 48, 320, 40],
        "text": "CHAPTER 1: INTRODUCTION",
        "readingOrder": 0,
        "confidence": 0.99,
        "pageNumber": 1,
    },
    {
        "id": "ocr-block-002",
        "bbox": [32, 100, 560, 180],
        "text": "Offline document processing keeps intellectual property and sensitive corporate data within local boundaries.",
        "readingOrder": 1,
        "confidence": 0.96,
        "pageNumber": 1,
    },
    {
        "id": "ocr-block-003",
        "bbox": [32, 290, 560, 90],
        "text": "Both text PDF files and scanned image documents can be parsed through reading order layout reconstruction.",
        "readingOrder": 2,
        "confidence": 0.94,
        "pageNumber": 1,
    },
]

# 与 mock.ts 的 mockAsrCues 对齐
MOCK_ASR_CUES = [
    {
        "id": "cue-001",
        "startTime": 0.0,
        "endTime": 2.85,
        "text": "Welcome to the bilingual browser translation tutorial.",
        "confidence": 0.98,
        "speaker": "speaker_1",
    },
    {
        "id": "cue-002",
        "startTime": 3.1,
        "endTime": 6.4,
        "text": "In this session, we demonstrate real-time offline speech recognition.",
        "confidence": 0.95,
        "speaker": "speaker_1",
    },
    {
        "id": "cue-003",
        "startTime": 6.75,
        "endTime": 10.2,
        "text": "Timestamps and audio cues remain aligned throughout media playback.",
        "confidence": 0.93,
        "speaker": "speaker_1",
    },
]

# 契约错误码全集（与 error.ts 对齐）
ERROR_CODES = [
    "AUTH_FAILED",
    "NETWORK_ERROR",
    "RATE_LIMITED",
    "MODEL_UNAVAILABLE",
    "TIMEOUT",
    "POLICY_VIOLATION",
    "INVALID_REQUEST",
    "ALIGNMENT_MISMATCH",
    "RESOURCE_NOT_FOUND",
    "UNSUPPORTED_PROTOCOL",
    "OFFLINE_REQUIRED",
    "CANCELLED",
    "INTERNAL_ERROR",
]
