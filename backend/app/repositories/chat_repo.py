# backend/app/repositories/chat_repo.py
# 對話與訊息的資料存取。每個查詢都明確帶入 user_id，確保只能讀寫自己的資料。
# 後端使用的是資料庫擁有者連線，會繞過 RLS，因此「user_id 過濾」必須由程式碼自己保證。

# 資料庫連線工具
from app.core.db import db_connection


def create_conversation(user_id: str, title: str) -> dict:
    # 建立一筆新對話並回傳它的資料
    with db_connection() as conn:
        row = conn.execute(
            "insert into public.conversations (user_id, title) values (%s, %s) returning id, title, created_at, updated_at",
            (user_id, title),
        ).fetchone()
        conn.commit()
    return dict(row)


def list_conversations(user_id: str, limit: int = 50) -> list[dict]:
    # 只列出屬於此使用者的對話，依最近更新時間排序
    with db_connection() as conn:
        rows = conn.execute(
            """
            select id, title, created_at, updated_at
            from public.conversations
            where user_id = %s
            order by updated_at desc
            limit %s
            """,
            (user_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def get_conversation_owned(user_id: str, conversation_id: str) -> dict | None:
    # 同時比對對話 id 與擁有者，若不是此使用者的對話就回傳 None（防止 IDOR）
    with db_connection() as conn:
        row = conn.execute(
            "select id, title from public.conversations where id = %s and user_id = %s",
            (conversation_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def list_messages(user_id: str, conversation_id: str) -> list[dict]:
    # 讀取訊息時同樣要求 user_id 相符，防止透過猜測 id 讀取他人訊息
    with db_connection() as conn:
        rows = conn.execute(
            """
            select id, role, content, model, created_at
            from public.messages
            where conversation_id = %s and user_id = %s
            order by created_at asc
            """,
            (conversation_id, user_id),
        ).fetchall()
    return [dict(row) for row in rows]


def add_message(user_id: str, conversation_id: str, role: str, content: str, model: str | None) -> None:
    # 寫入一則訊息，並同時更新對話的 updated_at 讓列表排序正確
    with db_connection() as conn:
        conn.execute(
            """
            insert into public.messages (conversation_id, user_id, role, content, model)
            values (%s, %s, %s, %s, %s)
            """,
            (conversation_id, user_id, role, content, model),
        )
        conn.execute(
            "update public.conversations set updated_at = now() where id = %s and user_id = %s",
            (conversation_id, user_id),
        )
        conn.commit()
