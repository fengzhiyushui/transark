"""引擎层测试：Ollama / 兼容端点适配器、错误映射与数据策略。"""

from __future__ import annotations

import json

import httpx
import pytest

from local_service.engines import EngineRegistry, OllamaEngine, OpenAIChatEngine
from local_service.engines.base import parse_engine_json
from local_service.models import (
    AppError,
    ErrorCode,
    TranslationProviderConfig,
    TranslationRequest,
)
from local_service.netguard import NetworkGuard
from local_service.settings import Settings


def _ollama_profile(**overrides) -> TranslationProviderConfig:
    payload = {
        "profileId": "local-ollama-qwen",
        "revision": 1,
        "name": "Ollama",
        "protocol": "ollama",
        "baseUrl": "http://127.0.0.1:11434",
        "model": "qwen2.5:7b",
        "auth": {"type": "none"},
        "dataPolicy": "device-only",
        "capabilities": {"textTranslation": True, "structuredOutput": True},
        "limits": {"timeoutMs": 5000},
    }
    payload.update(overrides)
    return TranslationProviderConfig.model_validate(payload)


def _request() -> TranslationRequest:
    return TranslationRequest.model_validate(
        {
            "requestId": "req-engine-1",
            "sourceLanguage": "en",
            "targetLanguage": "zh-CN",
            "segments": [{"id": "seg-1", "text": "Hello"}],
        }
    )


def _mock_transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _ollama_ok_response(request: httpx.Request) -> httpx.Response:
    payload = {
        "model": "qwen2.5:7b",
        "message": {
            "role": "assistant",
            "content": json.dumps([{"id": "seg-1", "translation": "你好"}]),
        },
        "prompt_eval_count": 11,
        "eval_count": 7,
    }
    return httpx.Response(200, json=payload)


@pytest.mark.asyncio
async def test_ollama_engine_posts_to_api_chat_and_parses_result():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content.decode("utf-8"))
        return _ollama_ok_response(request)

    engine = OllamaEngine(_ollama_profile(), guard, transport=_mock_transport(handler))
    response = await engine.translate(_request())

    assert seen["url"] == "http://127.0.0.1:11434/api/chat"
    assert seen["body"]["model"] == "qwen2.5:7b"
    assert seen["body"]["stream"] is False
    assert seen["body"]["format"] == "json"
    assert response.segments[0].translation == "你好"
    assert response.resolved_engine.id == "ollama/qwen2.5:7b"
    assert response.metrics.prompt_tokens == 11
    assert response.metrics.completion_tokens == 7


@pytest.mark.asyncio
async def test_ollama_engine_handles_base_url_with_api_suffix():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return _ollama_ok_response(request)

    profile = _ollama_profile(baseUrl="http://localhost:11434/api")
    engine = OllamaEngine(profile, guard, transport=_mock_transport(handler))
    await engine.translate(_request())
    assert seen["url"] == "http://localhost:11434/api/chat"


@pytest.mark.asyncio
async def test_ollama_engine_tolerates_code_fenced_json():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)

    def handler(request: httpx.Request) -> httpx.Response:
        payload = {
            "message": {
                "role": "assistant",
                "content": '```json\n[{"id": "seg-1", "translation": "你好，世界"}]\n```',
            }
        }
        return httpx.Response(200, json=payload)

    engine = OllamaEngine(_ollama_profile(), guard, transport=_mock_transport(handler))
    response = await engine.translate(_request())
    assert response.segments[0].translation == "你好，世界"


@pytest.mark.asyncio
async def test_ollama_engine_maps_http_errors_to_contract_codes():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)
    cases = [
        (401, ErrorCode.AUTH_FAILED),
        (404, ErrorCode.MODEL_UNAVAILABLE),
        (429, ErrorCode.RATE_LIMITED),
        (400, ErrorCode.INVALID_REQUEST),
        (500, ErrorCode.NETWORK_ERROR),
    ]
    for status, expected in cases:
        engine = OllamaEngine(
            _ollama_profile(),
            guard,
            transport=_mock_transport(lambda request: httpx.Response(status, json={"error": "x"})),
        )
        with pytest.raises(AppError) as exc_info:
            await engine.translate(_request())
        assert exc_info.value.code == expected, status


@pytest.mark.asyncio
async def test_ollama_engine_maps_connection_error():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    engine = OllamaEngine(_ollama_profile(), guard, transport=_mock_transport(handler))
    with pytest.raises(AppError) as exc_info:
        await engine.translate(_request())
    assert exc_info.value.code == ErrorCode.NETWORK_ERROR


@pytest.mark.asyncio
async def test_openai_chat_engine_endpoint_join_and_parsing():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        payload = {
            "choices": [
                {"message": {"role": "assistant", "content": '{"segments": [{"id": "seg-1", "translation": "嗨"}]}'}}
            ],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
        }
        return httpx.Response(200, json=payload)

    profile = TranslationProviderConfig.model_validate(
        {
            "profileId": "lan-gateway",
            "revision": 1,
            "name": "LAN gateway",
            "protocol": "openai-chat",
            "baseUrl": "http://192.168.1.120:8000/v1",
            "model": "Qwen/Qwen2.5-14B-Instruct",
            "auth": {"type": "bearer", "token": "k"},
            "dataPolicy": "allow-lan",
            "capabilities": {"textTranslation": True, "structuredOutput": True},
        }
    )
    engine = OpenAIChatEngine(profile, guard, transport=_mock_transport(handler))
    response = await engine.translate(_request())

    assert seen["url"] == "http://192.168.1.120:8000/v1/chat/completions"
    assert response.segments[0].translation == "嗨"
    assert response.metrics.prompt_tokens == 5


@pytest.mark.asyncio
async def test_openai_chat_engine_sends_auth_header():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization")
        payload = {"choices": [{"message": {"content": '[{"id": "seg-1", "translation": "ok"}]'}}]}
        return httpx.Response(200, json=payload)

    profile = TranslationProviderConfig.model_validate(
        {
            "profileId": "lan-gateway",
            "revision": 1,
            "name": "LAN gateway",
            "protocol": "openai-chat",
            "baseUrl": "http://192.168.1.120:8000/v1",
            "model": "m",
            "auth": {"type": "bearer", "token": "secret-token"},
            "dataPolicy": "allow-lan",
            "capabilities": {"textTranslation": True},
        }
    )
    engine = OpenAIChatEngine(profile, guard, transport=_mock_transport(handler))
    await engine.translate(_request())
    assert seen["authorization"] == "Bearer secret-token"


def test_unsupported_protocol_is_not_silently_supported():
    settings = Settings(data_dir=":memory:", pairing_code="x")
    guard = NetworkGuard(settings)
    registry = EngineRegistry(guard)
    profile = _ollama_profile(protocol="openai-responses")
    with pytest.raises(AppError) as exc_info:
        registry.resolve(profile)
    assert exc_info.value.code == ErrorCode.UNSUPPORTED_PROTOCOL


def test_parse_engine_json_variants():
    assert parse_engine_json('[{"id": "a", "translation": "b"}]') == [{"id": "a", "translation": "b"}]
    assert parse_engine_json('前言 [{"id": "a", "translation": "b"}] 后记') == [
        {"id": "a", "translation": "b"}
    ]
    with pytest.raises(AppError):
        parse_engine_json("no json here")
