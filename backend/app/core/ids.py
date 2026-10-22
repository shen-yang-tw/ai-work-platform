# backend/app/core/ids.py
# 共用的 id 驗證工具。非法格式的 id 直接回 404，避免非 UUID 字串進入資料庫查詢造成 500 錯誤。

# uuid 用來解析與標準化 UUID 字串
import uuid

# HTTPException 讓驗證失敗時直接以 404 回應
from fastapi import HTTPException


def parse_uuid_or_404(value: str) -> str:
    # 解析成功就回傳標準化的小寫字串；失敗就回 404，不透露 id 是否存在
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="找不到資料") from exc
