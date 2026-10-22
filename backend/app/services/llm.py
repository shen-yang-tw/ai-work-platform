# backend/app/services/llm.py
# 對話的供應商選擇與備援。先用 Gemini 免費層；若在開始輸出前失敗，自動改用本機 Ollama。

# AsyncIterator 用來標註串流產生器的型別
from typing import AsyncIterator

# 讀取各模型名稱
from app.core.config import settings
# 兩個供應商的串流實作
from app.services import gemini, ollama
# 統一錯誤型別
from app.services.errors import ProviderError


async def stream_with_fallback(
    messages: list[dict],
    temperature: float,
    max_tokens: int,
    usage: dict,
) -> AsyncIterator[str]:
    # usage 會被填入實際使用的供應商、模型名稱與 Token 數，供上層記錄
    started = False
    usage["provider"] = "gemini"
    usage["model"] = settings.gemini_chat_model
    try:
        async for text in gemini.stream_chat(messages, temperature, max_tokens, usage):
            # 只要有任何一段文字已送給使用者，就不能再切換，否則內容會接續錯亂
            started = True
            yield text
        return
    except ProviderError:
        # 若已經開始輸出，就直接把錯誤往上拋，由 API 層告知前端
        if started:
            raise

    # Gemini 在開始前失敗（例如免費額度用完），改用本機 Ollama
    usage.pop("tokens", None)
    usage["provider"] = "ollama"
    usage["model"] = settings.ollama_chat_model
    async for text in ollama.stream_chat(messages, temperature, max_tokens, usage):
        yield text
