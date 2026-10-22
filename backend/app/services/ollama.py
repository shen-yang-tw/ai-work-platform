# backend/app/services/ollama.py
# 本機 Ollama 的對話串流。Ollama 回傳的是「每行一個 JSON」（NDJSON）格式。

# AsyncIterator 用來標註串流產生器的型別
from typing import AsyncIterator
# json 用來解析每一行的回應
import json

# unicodedata 用來判斷字元是否為標點或空白，作為安全的切點
import unicodedata

# httpx 用來以非同步方式呼叫 Ollama 的 HTTP 端點
import httpx
# opencc 用來把簡體字轉為台灣繁體（含台灣慣用詞）
import opencc

# 讀取 Ollama 位址與模型名稱
from app.core.config import settings
# 統一錯誤型別
from app.services.errors import ProviderError

# s2twp：簡體 → 台灣繁體，並套用台灣慣用詞（例如 软件 → 軟體、数据 → 數據）
_to_tw = opencc.OpenCC("s2twp")
# 尚未輸出的文字超過這個長度且找不到標點時，才強制切分（保底，避免一直不輸出）
_MAX_PENDING = 40
# 強制切分時，尾端保留的字元數，讓詞組有機會完整留在下一段
_HOLD_CHARS = 16


def _is_break(ch: str) -> bool:
    # 標點（類別 P）與空白都可以當切點，詞組通常不會跨過標點
    return ch.isspace() or unicodedata.category(ch).startswith("P")


def _split_point(buf: str) -> int:
    # 從尾端往前找最後一個標點或空白，回傳切點（切點之前的文字可以安全轉換）
    for i in range(len(buf) - 1, -1, -1):
        if _is_break(buf[i]):
            return i + 1
    return 0


async def stream_chat(
    messages: list[dict],
    temperature: float,
    max_tokens: int,
    usage: dict,
) -> AsyncIterator[str]:
    # Ollama 的聊天端點
    url = f"{settings.ollama_base_url}/api/chat"
    body = {
        "model": settings.ollama_chat_model,
        # Ollama 的 messages 格式與我們一致：role 與 content
        "messages": messages,
        # 開啟串流，回應會逐行送回
        "stream": True,
        "options": {
            # 溫度控制回答的隨機程度
            "temperature": temperature,
            # num_predict 是 Ollama 對最大輸出 Token 數的設定
            "num_predict": max_tokens,
        },
    }

    try:
        # 本機 CPU 推論較慢，讀取逾時設為 300 秒
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
            async with client.stream("POST", url, json=body) as response:
                if response.status_code >= 400:
                    raise ProviderError(f"Ollama 請求失敗（{response.status_code}）")

                # 尚未輸出的文字暫存區，用來做簡轉繁的尾端緩衝
                pending = ""
                # 逐行讀取 NDJSON 回應
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)

                    # 最後一行 done 為 true，會附帶實際用量（輸入與輸出 Token 數）
                    if chunk.get("done"):
                        usage["tokens"] = int(chunk.get("prompt_eval_count", 0)) + int(chunk.get("eval_count", 0))
                        continue

                    # 每行的文字片段在 message.content 中
                    text = (chunk.get("message") or {}).get("content")
                    if not text:
                        continue
                    pending += text
                    # 優先在標點或空白處切分；找不到且累積過長時才用保底切點
                    cut = _split_point(pending)
                    if cut == 0 and len(pending) > _MAX_PENDING:
                        cut = len(pending) - _HOLD_CHARS
                    if cut > 0:
                        yield _to_tw.convert(pending[:cut])
                        pending = pending[cut:]

                # 串流結束後，把剩下的尾段一次轉換輸出
                if pending:
                    yield _to_tw.convert(pending)
    except httpx.HTTPError as exc:
        # 連線失敗或逾時，統一轉為 ProviderError
        raise ProviderError("無法連線到本機 Ollama") from exc
