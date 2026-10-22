# backend/app/api/meta.py
# 健康檢查與狀態端點。狀態只回報「是否已設定」，絕不回傳任何金鑰的內容。

# asyncio.to_thread 讓同步的用量查詢不阻塞事件迴圈
import asyncio

# FastAPI 路由
from fastapi import APIRouter

# 設定、驗證依賴與用量查詢
from app.core.config import settings
from app.core.security import CurrentUserId
from app.repositories import usage_repo

# 路由群組，不設定前綴，路徑直接寫完整
router = APIRouter(tags=["meta"])


@router.get("/api/health")
async def health() -> dict:
    # 不需要登入的存活檢查，供 Docker 與 Cloudflare Tunnel 確認服務正常
    return {"status": "ok"}


@router.get("/api/status")
async def status(user_id: str = CurrentUserId) -> dict:
    # 讀取今天的個人用量，用來顯示在設定頁
    usage = await asyncio.to_thread(usage_repo.get_user_usage_today, user_id)
    return {
        # 只回報布林值，代表金鑰是否已設定，不回傳金鑰本身
        "gemini_key_configured": bool(settings.gemini_api_key),
        "database_configured": bool(settings.database_url),
        "ollama_model": settings.ollama_chat_model,
        "usage_today": usage,
        "limits": {
            "user_daily_tokens": settings.user_daily_token_limit,
            "user_daily_uploads": settings.user_daily_upload_limit,
            "user_rpm": settings.user_rpm_limit,
        },
    }
