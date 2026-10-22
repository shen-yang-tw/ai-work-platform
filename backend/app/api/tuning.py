# backend/app/api/tuning.py
# 模型參數比較 API：同一個問題同時送給 Gemini（左）與本機 Ollama（右），兩邊的輸出交錯串流回前端。

# asyncio 用來同時執行兩條串流，並透過佇列合併輸出
import asyncio
# json 用來序列化 SSE 事件
import json
# logging 寫入伺服器日誌
import logging
# AsyncIterator 用於標註產生器型別
from typing import AsyncIterator

# FastAPI 路由與串流回應
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

# 設定、速率限制、驗證依賴與資料存取
from app.core.config import settings
from app.core.rate_limit import check_ai_rate_limit
from app.core.security import CurrentUserId
from app.repositories import usage_repo
from app.schemas.models import CompareRequest
from app.services import gemini, ollama
from app.services.budget import BudgetExceeded, ensure_budget, estimate_tokens
from app.services.errors import ProviderError

# 路由群組，路徑以 /api/tuning 開頭
router = APIRouter(prefix="/api/tuning", tags=["tuning"])
# 日誌記錄器
logger = logging.getLogger(__name__)


def _sse(event: str, payload: dict) -> str:
    # 組出 SSE 格式的事件字串，中文不做 Unicode 跳脫
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/compare")
async def compare(body: CompareRequest, user_id: str = CurrentUserId) -> StreamingResponse:
    # 一次比較會呼叫兩個模型，所以速率限制只檢查一次，但用量記為兩次請求
    check_ai_rate_limit(user_id)
    try:
        await asyncio.to_thread(ensure_budget, user_id)
    except BudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    # 單輪問答不帶歷史，只傳入使用者目前的問題
    messages = [{"role": "user", "content": body.message}]
    # 每一側各自的用量資訊與已收集的文字
    usages: dict[str, dict] = {"left": {}, "right": {}}
    collected: dict[str, list[str]] = {"left": [], "right": []}
    # 佇列是兩條串流的共同出口，確保事件依真實到達順序送出
    queue: asyncio.Queue = asyncio.Queue()

    # 把單一供應商的串流轉進佇列，並標上左或右的標籤
    async def pump(side: str, generator: AsyncIterator[str]) -> None:
        try:
            async for text in generator:
                collected[side].append(text)
                await queue.put(("token", side, text))
        except ProviderError:
            await queue.put(("error", side, "此模型暫時無法使用"))
        except Exception:
            # 未預期錯誤只寫日誌，前端只看到通用訊息
            logger.exception("比較模式發生未預期錯誤")
            await queue.put(("error", side, "伺服器發生錯誤"))
        finally:
            # 無論成功或失敗，都送出結束標記，讓消費端知道這一側已完成
            await queue.put(("end", side, None))

    async def event_stream() -> AsyncIterator[str]:
        # 左側為 Gemini 免費層，右側為本機 Ollama
        left_gen = gemini.stream_chat(messages, body.temperature, body.max_tokens, usages["left"])
        right_gen = ollama.stream_chat(messages, body.temperature, body.max_tokens, usages["right"])
        usages["left"].update({"provider": "gemini", "model": settings.gemini_chat_model})
        usages["right"].update({"provider": "ollama", "model": settings.ollama_chat_model})

        # 先告訴前端兩側各是什麼模型，方便畫面顯示標題
        yield _sse("meta", {
            "left": {"provider": "gemini", "model": settings.gemini_chat_model},
            "right": {"provider": "ollama", "model": settings.ollama_chat_model},
        })

        tasks = [
            asyncio.create_task(pump("left", left_gen)),
            asyncio.create_task(pump("right", right_gen)),
        ]
        remaining = 2
        try:
            # 兩側都送出結束標記後才跳出迴圈
            while remaining:
                kind, side, payload = await queue.get()
                if kind == "token":
                    yield _sse("token", {"side": side, "text": payload})
                elif kind == "error":
                    yield _sse("error", {"side": side, "message": payload})
                else:
                    remaining -= 1
                    yield _sse("end", {"side": side})
        finally:
            # 若瀏覽器中途關閉，取消尚未完成的任務，避免浪費模型資源
            for task in tasks:
                task.cancel()

        # 兩側各自記錄用量：優先用供應商回報值，沒有時使用粗估值
        total = 0
        for side in ("left", "right"):
            text = "".join(collected[side])
            total += usages[side].get("tokens") or estimate_tokens(body.message + text)
        await asyncio.to_thread(usage_repo.add_usage, user_id, total, 0, 2)
        yield _sse("done", {"tokens": total})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
