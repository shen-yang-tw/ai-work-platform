# backend/app/repositories/knowledge_repo.py
# 文件與向量資料存取。向量以 pgvector 文字格式傳入，並用參數化查詢寫入與搜尋。

# 資料庫連線工具
from app.core.db import db_connection


def to_pgvector_literal(values: list[float]) -> str:
    # pgvector 接受 '[0.1,0.2,...]' 這種文字格式；這裡只產生數字，不含任何使用者輸入
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


def insert_document(user_id: str, filename: str, mime_type: str, size_bytes: int) -> str:
    # 先建立文件紀錄，狀態為 pending，處理完成後再改成 ready
    with db_connection() as conn:
        row = conn.execute(
            """
            insert into public.documents (user_id, filename, mime_type, size_bytes, status)
            values (%s, %s, %s, %s, 'pending')
            returning id
            """,
            (user_id, filename, mime_type, size_bytes),
        ).fetchone()
        conn.commit()
    return str(row["id"])


def set_document_status(user_id: str, document_id: str, status: str) -> None:
    # 更新文件狀態；同時比對 user_id，避免改到別人的文件
    with db_connection() as conn:
        conn.execute(
            "update public.documents set status = %s where id = %s and user_id = %s",
            (status, document_id, user_id),
        )
        conn.commit()


def insert_chunks(user_id: str, document_id: str, chunks: list[str], vectors: list[list[float]]) -> None:
    # 一次寫入整份文件的所有切片；每個切片與其向量成對寫入
    with db_connection() as conn:
        with conn.cursor() as cur:
            for index, (content, vector) in enumerate(zip(chunks, vectors)):
                # on conflict do nothing：同一份文件重複寫入時不會產生重複切片
                cur.execute(
                    """
                    insert into public.document_chunks (document_id, user_id, chunk_index, content, embedding)
                    values (%s, %s, %s, %s, %s::extensions.vector)
                    on conflict (document_id, chunk_index) do nothing
                    """,
                    (document_id, user_id, index, content, to_pgvector_literal(vector)),
                )
        conn.commit()


def list_documents(user_id: str) -> list[dict]:
    # 列出此使用者自己的文件紀錄
    with db_connection() as conn:
        rows = conn.execute(
            """
            select id, filename, mime_type, size_bytes, status, created_at
            from public.documents
            where user_id = %s
            order by created_at desc
            limit 100
            """,
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def document_exists_by_name(user_id: str, filename: str) -> bool:
    # 用於範例知識庫的冪等檢查：同名文件已存在就不重複建立
    with db_connection() as conn:
        row = conn.execute(
            "select 1 from public.documents where user_id = %s and filename = %s limit 1",
            (user_id, filename),
        ).fetchone()
    return row is not None


def search_similar_chunks(user_id: str, query_vector: list[float], top_k: int) -> list[dict]:
    # 以餘弦距離搜尋最相近的切片，只搜尋此使用者自己的文件
    literal = to_pgvector_literal(query_vector)
    with db_connection() as conn:
        rows = conn.execute(
            """
            select content, 1 - (embedding <=> %s::extensions.vector) as score
            from public.document_chunks
            where user_id = %s
            order by embedding <=> %s::extensions.vector
            limit %s
            """,
            (literal, user_id, literal, top_k),
        ).fetchall()
    return [dict(row) for row in rows]
