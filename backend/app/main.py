# backend/app/main.py
# FastAPI 應用程式入口。負責組裝路由、CORS、安全標頭、錯誤處理與關閉時的資源釋放。

# logging 把未預期錯誤寫入伺服器日誌
import logging
# asynccontextmanager 讓 lifespan 以 yield 的方式分成啟動與關閉兩段
from contextlib import asynccontextmanager
# AsyncIterator 用於標註 lifespan 的型別
from typing import AsyncIterator

# FastAPI 應用程式、請求物件與 CORS 中介層
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# 設定、資料庫連線池的關閉函式
from app.api import chat, knowledge, meta, prompts, tuning
from app.core.config import settings
from app.core.db import close_pool

# 日誌記錄器
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # yield 之前是啟動流程（目前不需要）；yield 之後是關閉流程，釋放資料庫連線池
    yield
    close_pool()


# 建立應用程式。docs、redoc、openapi 全部關閉，避免公開暴露完整 API 結構
app = FastAPI(
    title="AI 工作平台 API",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# CORS 只允許設定檔中列出的前端網域；不允許攜帶 Cookie，因為我們使用 Bearer Token
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    # 先等待下游處理完成，再於回應上加上安全標頭
    response = await call_next(request)
    # 禁止瀏覽器猜測 MIME 類型，防止內容被誤判執行
    response.headers["X-Content-Type-Options"] = "nosniff"
    # 禁止被其他網站以 iframe 嵌入，防止點擊劫持
    response.headers["X-Frame-Options"] = "DENY"
    # 不回傳來源網址，減少資訊外洩
    response.headers["Referrer-Policy"] = "no-referrer"
    # API 回應不需要載入任何資源，因此全部來源都設為 none
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    return response


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    # 未被捕捉的錯誤：完整內容寫入日誌，回給使用者的只有通用訊息，不洩漏堆疊或內部路徑
    logger.error("未處理的例外：%s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"detail": "伺服器發生錯誤"})


# 依功能註冊各組路由
app.include_router(meta.router)
app.include_router(chat.router)
app.include_router(knowledge.router)
app.include_router(tuning.router)
app.include_router(prompts.router)
