# backend/app/services/gemini.py
# Gemini 免費層的對話串流與 Embedding 呼叫。使用官方 REST API，金鑰放在 HTTP 標頭中。

# AsyncIterator 用來標註串流產生器的型別
from typing import AsyncIterator
# json 用來解析 Gemini 回傳的 SSE 資料行
import json

# httpx 是支援非同步串流的 HTTP 用戶端
import httpx

# 讀取金鑰、模型名稱與維度設定
from app.core.config import settings
# 統一的供應商錯誤型別，讓上層可以判斷是否要切換到備援
from app.services.errors import ProviderError

# 單次 Embedding 批次的上限（Gemini batchEmbedContents 一次最多 100 筆）
_EMBED_BATCH_SIZE = 100


def _role_for_gemini(role: str) -> str:
    # Gemini 把助理的角色叫做 model，其他角色轉成 user
    return "model" if role == "assistant" else "user"


async def stream_chat(
    messages: list[dict],
    temperature: float,
    max_tokens: int,
    usage: dict,
) -> AsyncIterator[str]:
    # 若沒有設定金鑰，直接視為供應商不可用，讓上層改用備援
    if not settings.gemini_api_key:
        raise ProviderError("Gemini 金鑰未設定")

    # 組出 Gemini 的串流端點，alt=sse 代表以 Server-Sent Events 格式回傳
    url = f"{settings.gemini_base_url}/models/{settings.gemini_chat_model}:streamGenerateContent?alt=sse"
    # 金鑰放在 x-goog-api-key 標頭，不放在網址上，避免被記錄到存取日誌
    headers = {"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"}
    # 把我們的訊息格式轉成 Gemini 的 contents 結構
    body = {
        "contents": [
            {"role": _role_for_gemini(m["role"]), "parts": [{"text": m["content"]}]} for m in messages
        ],
        # thinkingLevel=minimal 關閉長時間思考：否則思考 Token 會吃掉 maxOutputTokens，導致回答只輸出一句就被截斷
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "thinkingConfig": {"thinkingLevel": "minimal"},
        },
    }

    # 設定逾時：連線 10 秒，讀取串流最長 30 秒（網路不穩時快速失敗，避免畫面長時間等待）
    timeout = httpx.Timeout(30.0, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 以串流方式送出請求，回應不會一次全部載入記憶體
            async with client.stream("POST", url, headers=headers, json=body) as response:
                # 429 代表免費額度用完，5xx 代表服務異常，兩者都丟出 ProviderError 讓上層切換
                if response.status_code == 429 or response.status_code >= 500:
                    raise ProviderError(f"Gemini 暫時不可用（{response.status_code}）")
                # 其他 4xx 代表請求本身有問題，直接視為錯誤
                if response.status_code >= 400:
                    raise ProviderError(f"Gemini 請求失敗（{response.status_code}）")

                # 逐行讀取 SSE 回應
                async for line in response.aiter_lines():
                    # 只處理以 data: 開頭的資料行，其他行（空行、註解）略過
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if not payload:
                        continue
                    chunk = json.loads(payload)

                    # 最後一個區塊通常會附帶 usageMetadata，記錄實際 Token 用量
                    if "usageMetadata" in chunk:
                        usage["tokens"] = int(chunk["usageMetadata"].get("totalTokenCount", 0))

                    # 取出候選回答的文字片段，沒有候選時略過
                    candidates = chunk.get("candidates") or []
                    if not candidates:
                        continue
                    parts = (candidates[0].get("content") or {}).get("parts") or []
                    for part in parts:
                        text = part.get("text")
                        if text:
                            yield text
                    # 結束原因是 MAX_TOKENS 代表回答被長度上限截斷，明確提示使用者，不讓它看起來像被中斷
                    if candidates[0].get("finishReason") == "MAX_TOKENS":
                        yield "\n\n> ⚠️ 已達最大 Token 上限，回答被截斷，可到「模型調校」調高。 / Max token limit reached; the answer was cut off."
    except httpx.HTTPError as exc:
        # 網路層錯誤（連線失敗、逾時）也統一轉為 ProviderError
        raise ProviderError("無法連線到 Gemini") from exc


async def embed_texts(texts: list[str], is_query: bool) -> list[list[float]]:
    # 沒有金鑰就無法做向量化，直接報錯
    if not settings.gemini_api_key:
        raise ProviderError("Gemini 金鑰未設定")

    # 查詢與文件使用不同的任務類型，可以提升檢索品質
    task_type = "RETRIEVAL_QUERY" if is_query else "RETRIEVAL_DOCUMENT"
    url = f"{settings.gemini_base_url}/models/{settings.gemini_embedding_model}:batchEmbedContents"
    headers = {"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"}

    results: list[list[float]] = []
    # 分批送出，每批最多 100 筆
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        for start in range(0, len(texts), _EMBED_BATCH_SIZE):
            batch = texts[start:start + _EMBED_BATCH_SIZE]
            body = {
                "requests": [
                    {
                        "model": f"models/{settings.gemini_embedding_model}",
                        "content": {"parts": [{"text": text}]},
                        "taskType": task_type,
                        # 指定輸出維度，必須與資料表 vector(1536) 一致
                        "outputDimensionality": settings.embedding_dimensions,
                    }
                    for text in batch
                ]
            }
            try:
                response = await client.post(url, headers=headers, json=body)
            except httpx.HTTPError as exc:
                raise ProviderError("無法連線到 Gemini Embedding") from exc

            if response.status_code >= 400:
                raise ProviderError(f"Gemini Embedding 失敗（{response.status_code}）")

            # 逐筆取出向量，並檢查維度是否正確，避免寫入錯誤維度造成資料庫錯誤
            for item in response.json().get("embeddings", []):
                values = item.get("values", [])
                if len(values) != settings.embedding_dimensions:
                    raise ProviderError("Embedding 維度與設定不符")
                results.append(values)

    # 數量不符代表回應不完整，視為錯誤
    if len(results) != len(texts):
        raise ProviderError("Embedding 回應數量不完整")
    return results
