# backend/app/api/chat.py
# 聊天 API：SSE 串流回答、對話列表與訊息讀取。所有端點都需要有效的 Supabase JWT。

# asyncio.to_thread 讓同步的資料庫呼叫不阻塞事件迴圈
import asyncio
# json 用來把事件資料序列化成 SSE 格式
import json
# logging 把內部錯誤寫入伺服器日誌，但不回傳給使用者
import logging
# AsyncIterator 用來標註串流產生器的型別
from typing import AsyncIterator

# FastAPI 路由、錯誤與串流回應類別
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

# 驗證依賴、速率限制與資料存取
from app.core.ids import parse_uuid_or_404
from app.core.rate_limit import check_ai_rate_limit
from app.core.security import CurrentUserId
from app.repositories import chat_repo, knowledge_repo, usage_repo
from app.schemas.models import ChatRequest, ConversationOut, MessageOut
from app.services import gemini, llm
from app.services.budget import BudgetExceeded, ensure_budget, estimate_tokens
from app.services.errors import ProviderError

# 建立路由群組，所有路徑都以 /api 開頭
router = APIRouter(prefix="/api", tags=["chat"])
# 日誌記錄器，名稱會顯示在伺服器日誌的來源欄位
logger = logging.getLogger(__name__)

# 每次送給模型的歷史訊息筆數上限，避免 Token 用量失控
_HISTORY_LIMIT = 20
# 知識庫檢索時取回的最相近切片數量
_RAG_TOP_K = 4


def _sse(event: str, payload: dict) -> str:
    # SSE 格式：event 行、data 行、空行結尾；ensure_ascii=False 讓中文不會被轉成 \uXXXX
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/chat/stream")
async def chat_stream(body: ChatRequest, user_id: str = CurrentUserId) -> StreamingResponse:
    # 先做速率限制，超過就直接回 429
    check_ai_rate_limit(user_id)
    # 檢查每日 Token 額度，用完就回 429 並說明原因
    try:
        await asyncio.to_thread(ensure_budget, user_id)
    except BudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    # 若帶入既有對話 id，必須確認它屬於此使用者；否則建立新對話
    if body.conversation_id:
        conversation_id = parse_uuid_or_404(body.conversation_id)
        owned = await asyncio.to_thread(chat_repo.get_conversation_owned, user_id, conversation_id)
        if owned is None:
            raise HTTPException(status_code=404, detail="找不到對話")
    else:
        # 新對話的標題取使用者第一句話的前 30 個字
        created = await asyncio.to_thread(chat_repo.create_conversation, user_id, body.message[:30])
        conversation_id = str(created["id"])

    # 先把使用者訊息存入資料庫，即使後續串流失敗，使用者的輸入也不會遺失
    await asyncio.to_thread(chat_repo.add_message, user_id, conversation_id, "user", body.message, None)

    async def event_stream() -> AsyncIterator[str]:
        # 第一個事件告訴前端對話 id，方便之後續接
        yield _sse("meta", {"conversation_id": conversation_id})

        # usage 會由供應商模組填入實際的供應商、模型與 Token 數
        usage: dict = {}
        # 收集完整回答，串流結束後一次存入資料庫
        parts: list[str] = []
        try:
            # 讀取最近的歷史訊息（包含剛剛存入的使用者訊息）
            rows = await asyncio.to_thread(chat_repo.list_messages, user_id, conversation_id)
            history = [{"role": row["role"], "content": row["content"]} for row in rows[-_HISTORY_LIMIT:]]

            # 若開啟知識庫，先把問題向量化並找出最相近的文件切片
            if body.use_knowledge:
                vectors = await gemini.embed_texts([body.message], is_query=True)
                hits = await asyncio.to_thread(knowledge_repo.search_similar_chunks, user_id, vectors[0], _RAG_TOP_K)
                if hits:
                    context = "\n\n".join(hit["content"] for hit in hits)
                    # 把參考資料包進最後一則使用者訊息，並要求模型優先依據資料回答
                    history[-1]["content"] = (
                        "以下是使用者文件中的參考資料，請優先依據它回答；資料不足時請明說。\n"
                        f"<參考資料>\n{context}\n</參考資料>\n\n問題：{body.message}"
                    )

            # 逐段接收模型輸出並立即轉送給前端
            async for text in llm.stream_with_fallback(history, body.temperature, body.max_tokens, usage):
                parts.append(text)
                yield _sse("token", {"text": text})
        except ProviderError:
            # 供應商錯誤訊息是固定的安全文字，不含金鑰或原始回應
            yield _sse("error", {"message": "AI 服務暫時無法使用，請稍後再試"})
            return
        except Exception:
            # 未預期的錯誤寫入日誌，前端只收到通用訊息
            logger.exception("聊天串流發生未預期錯誤")
            yield _sse("error", {"message": "伺服器發生錯誤，請稍後再試"})
            return

        full_text = "".join(parts)
        if not full_text:
            yield _sse("error", {"message": "AI 沒有回傳內容，請稍後再試"})
            return

        # 優先使用供應商回報的實際 Token 數；沒有時才用粗估值
        tokens = usage.get("tokens") or estimate_tokens(body.message + full_text)
        model_name = usage.get("model")
        await asyncio.to_thread(chat_repo.add_message, user_id, conversation_id, "assistant", full_text, model_name)
        await asyncio.to_thread(usage_repo.add_usage, user_id, tokens, 0, 1)
        yield _sse("done", {"provider": usage.get("provider"), "model": model_name, "tokens": tokens})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        # no-cache 避免中間快取把串流內容緩存起來
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(user_id: str = CurrentUserId) -> list[ConversationOut]:
    # 列出此使用者的對話，並把 UUID 轉成字串以符合回應格式
    rows = await asyncio.to_thread(chat_repo.list_conversations, user_id)
    return [ConversationOut(id=str(r["id"]), title=r["title"], created_at=r["created_at"], updated_at=r["updated_at"]) for r in rows]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(conversation_id: str, user_id: str = CurrentUserId) -> list[MessageOut]:
    # 先驗證格式，再確認對話屬於此使用者，最後才讀取訊息
    safe_id = parse_uuid_or_404(conversation_id)
    owned = await asyncio.to_thread(chat_repo.get_conversation_owned, user_id, safe_id)
    if owned is None:
        raise HTTPException(status_code=404, detail="找不到對話")
    rows = await asyncio.to_thread(chat_repo.list_messages, user_id, safe_id)
    return [
        MessageOut(id=str(r["id"]), role=r["role"], content=r["content"], model=r["model"], created_at=r["created_at"])
        for r in rows
    ]
