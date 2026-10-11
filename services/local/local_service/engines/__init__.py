"""翻译引擎包。"""

from .base import (
    TranslationEngine,
    build_auth_headers,
    join_endpoint,
    map_http_error,
    parse_engine_json,
    translation_prompt,
)
from .echo import BuiltinEngine
from .ollama import OllamaEngine
from .openai_chat import OpenAIChatEngine
from .registry import SUPPORTED_PROTOCOLS, EngineRegistry

__all__ = [
    "TranslationEngine",
    "EngineRegistry",
    "SUPPORTED_PROTOCOLS",
    "BuiltinEngine",
    "OllamaEngine",
    "OpenAIChatEngine",
    "build_auth_headers",
    "join_endpoint",
    "map_http_error",
    "parse_engine_json",
    "translation_prompt",
]
