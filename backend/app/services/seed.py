# backend/app/services/seed.py
# 預置範例知識庫的內容。使用者在 /knowledge 頁面按一下即可匯入，方便立即測試檢索功能。

# dataclass 讓範例文件的結構更清楚
from dataclasses import dataclass


@dataclass(frozen=True)
class SampleDocument:
    # 範例檔名，同時作為冪等判斷的依據，避免重複匯入
    filename: str
    # 範例文字內容
    text: str


SAMPLE_DOCUMENTS: tuple[SampleDocument, ...] = (
    SampleDocument(
        filename="sample-rag-basics.md",
        text=(
            "# RAG 基礎概念\n\n"
            "RAG（Retrieval-Augmented Generation，檢索增強生成）是一種讓語言模型回答前先查資料的方法。\n"
            "流程分為三步：先把文件切成小段落，再把每段轉換成向量並存入資料庫；"
            "使用者提問時，把問題也轉成向量，找出最相近的段落；最後把這些段落連同問題一起交給模型。\n\n"
            "RAG 的好處是模型能根據最新或私有的文件回答，並且可以附上來源，降低憑空編造的機率。"
        ),
    ),
    SampleDocument(
        filename="sample-pgvector.md",
        text=(
            "# pgvector 向量資料庫擴充\n\n"
            "pgvector 是 PostgreSQL 的擴充套件，可以儲存向量並計算相似度。\n"
            "常見的距離計算方式有餘弦距離（cosine distance）與歐式距離（L2 distance）。\n"
            "HNSW 是一種近似最近鄰索引，能在大量向量中快速找出相似結果，代價是略微犧牲精準度。\n\n"
            "在 Supabase 中可以直接啟用 vector 擴充，並把向量欄位定義為固定維度，例如 vector(1536)。"
        ),
    ),
)
