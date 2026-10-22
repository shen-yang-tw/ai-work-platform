# backend/app/repositories/prompt_repo.py
# Prompt 草稿與 Prompt 庫的資料存取。所有查詢都以 user_id 限定範圍。

# 資料庫連線工具
from app.core.db import db_connection


def get_draft(user_id: str) -> str:
    # 讀取使用者的 Prompt 草稿，沒有就回傳空字串
    with db_connection() as conn:
        row = conn.execute(
            "select body from public.prompt_drafts where user_id = %s",
            (user_id,),
        ).fetchone()
    return row["body"] if row else ""


def upsert_draft(user_id: str, body: str) -> None:
    # 草稿每人只有一筆，存在就更新，不存在就新增
    with db_connection() as conn:
        conn.execute(
            """
            insert into public.prompt_drafts (user_id, body, updated_at)
            values (%s, %s, now())
            on conflict (user_id) do update set body = excluded.body, updated_at = now()
            """,
            (user_id, body),
        )
        conn.commit()


def list_prompts(user_id: str) -> list[dict]:
    # 列出此使用者的 Prompt 庫，最近修改的排在前面
    with db_connection() as conn:
        rows = conn.execute(
            """
            select id, title, body, created_at, updated_at
            from public.prompts
            where user_id = %s
            order by updated_at desc
            limit 200
            """,
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_prompt(user_id: str, title: str, body: str) -> dict:
    # 新增一筆 Prompt，並回傳新建立的資料
    with db_connection() as conn:
        row = conn.execute(
            """
            insert into public.prompts (user_id, title, body)
            values (%s, %s, %s)
            returning id, title, body, created_at, updated_at
            """,
            (user_id, title, body),
        ).fetchone()
        conn.commit()
    return dict(row)


def update_prompt(user_id: str, prompt_id: str, title: str, body: str) -> dict | None:
    # 更新時同時比對 id 與 user_id；不是自己的資料會回傳 None
    with db_connection() as conn:
        row = conn.execute(
            """
            update public.prompts
            set title = %s, body = %s, updated_at = now()
            where id = %s and user_id = %s
            returning id, title, body, created_at, updated_at
            """,
            (title, body, prompt_id, user_id),
        ).fetchone()
        conn.commit()
    return dict(row) if row else None


def delete_prompt(user_id: str, prompt_id: str) -> bool:
    # 只刪除「自己」的指定一筆；前端會先經過使用者確認對話框才會呼叫此 API
    with db_connection() as conn:
        cur = conn.execute(
            "delete from public.prompts where id = %s and user_id = %s",
            (prompt_id, user_id),
        )
        conn.commit()
        # rowcount 為 1 代表真的刪到一筆，0 代表找不到或不是自己的
        return cur.rowcount == 1
