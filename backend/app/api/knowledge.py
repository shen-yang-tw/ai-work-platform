# backend/app/api/knowledge.py
# 文件向量化 API：上傳、列表與一鍵匯入範例知識庫。上傳流程是「驗證 → 解析 → 切片 → 向量化 → 寫入資料庫」。

# asyncio.to_thread 讓同步的解析與資料庫操作不阻塞事件迴圈
import asyncio
# logging 把內部錯誤寫入伺服器日誌
import logging
# re 用來清理檔名中的危險字元
import re

# FastAPI 的上傳檔案型別與錯誤工具
from fastapi import APIRouter, File, HTTPException, UploadFile

# 設定、速率限制、驗證依賴與資料存取
from app.core.config import settings
from app.core.rate_limit import check_ai_rate_limit
from app.core.security import CurrentUserId
from app.repositories import knowledge_repo, usage_repo
# 文件解析、切片、預置範例與額度檢查
from app.services import documents, gemini
from app.services.budget import BudgetExceeded, ensure_budget, estimate_tokens
from app.services.documents import DocumentError
from app.services.errors import ProviderError
from app.services.seed import SAMPLE_DOCUMENTS

# 路由群組，所有路徑都以 /api/knowledge 開頭
router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])
# 日誌記錄器
logger = logging.getLogger(__name__)


def _safe_filename(raw: str) -> str:
    # 只保留最後一段檔名，防止使用者傳入路徑（例如 ../../etc/passwd）
    name = re.split(r"[\\/]", raw)[-1].strip()
    # 把非字母、數字、底線、點、連字號、空白與中日韓字元的字元全部換成底線
    name = re.sub(r"[^\w.\- ()\u3000-\u9fff]", "_", name)
    # 限制長度，避免超長檔名撐爆資料庫欄位
    name = name[:255]
    if not name:
        raise HTTPException(status_code=422, detail="檔名不可為空")
    return name


async def _check_upload_quota(user_id: str) -> None:
    # 先確認速率限制，再確認每日上傳次數
    check_ai_rate_limit(user_id)
    usage = await asyncio.to_thread(usage_repo.get_user_usage_today, user_id)
    if usage["uploads"] >= settings.user_daily_upload_limit:
        raise HTTPException(status_code=429, detail="今日上傳次數已達上限，請明天再試")


async def _ingest(user_id: str, filename: str, mime_type: str, size: int, chunks: list[str]) -> dict:
    # 每次匯入都先計入上傳次數，即使後續失敗也計算，防止用失敗來無限消耗資源
    await asyncio.to_thread(usage_repo.add_usage, user_id, 0, 1, 0)

    # 估算向量化要消耗的 Token，超過額度就直接拒絕
    estimated = sum(estimate_tokens(chunk) for chunk in chunks)
    try:
        await asyncio.to_thread(ensure_budget, user_id)
    except BudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    # 先建立文件紀錄，狀態為 processing，讓前端可以顯示進度
    doc_id = await asyncio.to_thread(knowledge_repo.insert_document, user_id, filename, mime_type, size)
    try:
        # 向量化是遠端呼叫，維度由 gemini.embed_texts 內部檢查
        vectors = await gemini.embed_texts(chunks, is_query=False)
        await asyncio.to_thread(knowledge_repo.insert_chunks, user_id, doc_id, chunks, vectors)
        await asyncio.to_thread(knowledge_repo.set_document_status, user_id, doc_id, "ready")
    except ProviderError as exc:
        await asyncio.to_thread(knowledge_repo.set_document_status, user_id, doc_id, "failed")
        raise HTTPException(status_code=502, detail="向量化服務暫時無法使用，請稍後再試") from exc
    except Exception as exc:
        # 未預期錯誤寫入日誌，對外只回傳通用訊息
        logger.exception("文件向量化發生未預期錯誤")
        await asyncio.to_thread(knowledge_repo.set_document_status, user_id, doc_id, "failed")
        raise HTTPException(status_code=500, detail="文件處理失敗") from exc

    # 記錄實際消耗的 Token（估算值）
    await asyncio.to_thread(usage_repo.add_usage, user_id, estimated, 0, 0)
    return {"id": str(doc_id), "filename": filename, "chunks": len(chunks)}


@router.post("/documents", status_code=201)
async def upload_document(file: UploadFile = File(...), user_id: str = CurrentUserId) -> dict:
    # 先檢查速率與每日上傳次數
    await _check_upload_quota(user_id)

    # 只讀取到上限加一個位元組，超過就知道檔案太大，不會把超大檔案整個載入記憶體
    safe_name = _safe_filename(file.filename or "")
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="檔案超過 10 MB 上限")
    if not data:
        raise HTTPException(status_code=422, detail="檔案是空的")

    # 驗證檔案類型與內容，並抽出純文字；解析屬於 CPU 工作，放到執行緒池執行
    try:
        mime_type = documents.detect_mime(safe_name, data)
        text = await asyncio.to_thread(documents.extract_text, mime_type, data)
    except DocumentError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    chunks = documents.chunk_text(text)
    return await _ingest(user_id, safe_name, mime_type, len(data), chunks)


@router.get("/documents")
async def list_documents(user_id: str = CurrentUserId) -> list[dict]:
    # 列出此使用者的文件與狀態，並把 UUID 轉成字串
    rows = await asyncio.to_thread(knowledge_repo.list_documents, user_id)
    return [{**row, "id": str(row["id"])} for row in rows]


@router.post("/seed")
async def seed_sample_knowledge(user_id: str = CurrentUserId) -> dict:
    # 匯入範例知識庫；已存在同名文件就略過，所以重複點擊是安全的
    await _check_upload_quota(user_id)

    created = 0
    skipped = 0
    for sample in SAMPLE_DOCUMENTS:
        exists = await asyncio.to_thread(knowledge_repo.document_exists_by_name, user_id, sample.filename)
        if exists:
            skipped += 1
            continue
        chunks = documents.chunk_text(sample.text)
        size = len(sample.text.encode("utf-8"))
        await _ingest(user_id, sample.filename, "text/markdown", size, chunks)
        created += 1
    return {"created": created, "skipped": skipped}
