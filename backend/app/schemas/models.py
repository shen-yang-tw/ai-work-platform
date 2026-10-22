# backend/app/schemas/models.py
# 所有 API 的請求與回應格式。Pydantic 會自動檢查型別與長度，不合法的請求在進入業務邏輯前就被擋下。

# 引入 datetime 以標註時間欄位的型別
from datetime import datetime
# 引入 Optional 以表示可為空的欄位
from typing import Optional

# BaseModel 是 Pydantic 的基底類別，Field 用來加上長度與範圍限制
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    # 既有對話的 ID；為空代表建立新對話
    conversation_id: Optional[str] = Field(default=None, max_length=64)
    # 使用者輸入的訊息，限制 1 到 8000 字元，避免超大輸入耗盡額度
    message: str = Field(min_length=1, max_length=8000)
    # 溫度範圍 0 到 2，超出範圍會被拒絕
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    # 最大輸出 Token 數，限制在 1 到 4096
    max_tokens: int = Field(default=1024, ge=1, le=4096)
    # 是否啟用文件知識庫（RAG）檢索
    use_knowledge: bool = False


class CompareRequest(BaseModel):
    # 比較頁的輸入訊息，與聊天相同的長度限制
    message: str = Field(min_length=1, max_length=8000)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, ge=1, le=4096)


class ConversationOut(BaseModel):
    # 對話列表的單筆資料
    id: str
    title: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    # 單則訊息的輸出格式
    id: str
    role: str
    content: str
    model: Optional[str] = None
    created_at: datetime


class DraftIn(BaseModel):
    # 自動儲存的草稿內容，最長 20000 字元
    body: str = Field(max_length=20000)


class PromptIn(BaseModel):
    # 提示詞庫的標題與內容，都有長度限制
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=20000)
