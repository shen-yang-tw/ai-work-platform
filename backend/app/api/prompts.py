# backend/app/api/prompts.py
# 草稿自動儲存與提示詞庫 API。所有查詢都由 user_id 限定，只能操作自己的資料。

# asyncio.to_thread 讓同步資料庫呼叫不阻塞事件迴圈
import asyncio

# FastAPI 路由與錯誤
from fastapi import APIRouter, HTTPException

# 驗證依賴與 id 工具
from app.core.ids import parse_uuid_or_404
from app.core.security import CurrentUserId
from app.repositories import prompt_repo
from app.schemas.models import DraftIn, PromptIn

# 路由群組，路徑以 /api/prompts 開頭
router = APIRouter(prefix="/api/prompts", tags=["prompts"])


@router.get("/draft")
async def get_draft(user_id: str = CurrentUserId) -> dict:
    # 讀取目前使用者的草稿內容，沒有草稿時回傳空字串
    body = await asyncio.to_thread(prompt_repo.get_draft, user_id)
    return {"body": body}


@router.put("/draft")
async def put_draft(payload: DraftIn, user_id: str = CurrentUserId) -> dict:
    # 以 upsert 方式覆寫草稿，前端會定時呼叫以達成自動儲存
    await asyncio.to_thread(prompt_repo.upsert_draft, user_id, payload.body)
    return {"ok": True}


@router.get("")
async def list_prompts(user_id: str = CurrentUserId) -> list[dict]:
    # 列出提示詞庫，並把 UUID 轉成字串
    rows = await asyncio.to_thread(prompt_repo.list_prompts, user_id)
    return [{**row, "id": str(row["id"])} for row in rows]


@router.post("", status_code=201)
async def create_prompt(payload: PromptIn, user_id: str = CurrentUserId) -> dict:
    # 新增一筆提示詞，標題與內容的長度已由 PromptIn 限制
    row = await asyncio.to_thread(prompt_repo.create_prompt, user_id, payload.title, payload.body)
    return {**row, "id": str(row["id"])}


@router.put("/{prompt_id}")
async def update_prompt(prompt_id: str, payload: PromptIn, user_id: str = CurrentUserId) -> dict:
    # 先驗證 id 格式，再更新；更新筆數為 0 代表不存在或不屬於此使用者
    safe_id = parse_uuid_or_404(prompt_id)
    row = await asyncio.to_thread(prompt_repo.update_prompt, user_id, safe_id, payload.title, payload.body)
    if row is None:
        raise HTTPException(status_code=404, detail="找不到提示詞")
    return {**row, "id": str(row["id"])}


@router.delete("/{prompt_id}")
async def delete_prompt(prompt_id: str, user_id: str = CurrentUserId) -> dict:
    # 刪除只會影響此使用者自己的提示詞。前端必須先經過使用者確認對話框才會呼叫這個端點
    safe_id = parse_uuid_or_404(prompt_id)
    deleted = await asyncio.to_thread(prompt_repo.delete_prompt, user_id, safe_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="找不到提示詞")
    return {"deleted": True}
