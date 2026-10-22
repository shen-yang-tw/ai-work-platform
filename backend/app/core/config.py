# backend/app/core/config.py
# 集中管理所有設定。所有機密都從環境變數（或本機 .env）讀取，程式碼內不寫入任何金鑰。

# 引入 Any 型別，供清理函式接收任意類型的輸入
from typing import Any

# pydantic_settings 負責把環境變數轉成有型別的設定物件
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 設定讀取規則：先讀環境變數，若存在 .env 檔案則一併讀取；未知的變數直接忽略
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---------- Supabase 驗證與資料庫 ----------
    # 用來驗證使用者 JWT 的公鑰端點（JWKS），只含公開金鑰
    supabase_jwks_url: str = ""
    # JWT 的發行者，必須與 Supabase Auth 發出的 iss 欄位完全一致
    supabase_jwt_issuer: str = ""
    # 後端直連 Postgres 的連線字串，屬於機密，只能放在環境變數
    database_url: str = ""
    # 登入狀態撤銷檢查的快取秒數：快取期間不重複查資料庫，登出後最遲在這段時間後生效
    session_check_cache_seconds: int = 30

    # ---------- Gemini ----------
    # Gemini API 金鑰，屬於機密，只能放在環境變數
    gemini_api_key: str = ""
    # Gemini 官方 REST 端點的基礎網址
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    # 對話使用的 Gemini 模型名稱
    gemini_chat_model: str = "gemini-3.6-flash"
    # Embedding 使用的 Gemini 模型名稱
    gemini_embedding_model: str = "gemini-embedding-001"
    # Embedding 輸出維度，必須與資料表 vector(1536) 一致
    embedding_dimensions: int = 1536

    # ---------- Ollama 本機模型 ----------
    # Ollama 服務在 Docker 內部網路中的位址
    ollama_base_url: str = "http://ollama:11434"
    # 本機備援與比較使用的模型名稱
    ollama_chat_model: str = "qwen2.5:3b"

    # ---------- 額度與限制（架構已定案） ----------
    # 每位使用者每日 Token 上限
    user_daily_token_limit: int = 500_000
    # 全站每日 Token 上限
    global_daily_token_limit: int = 2_000_000
    # 單檔上傳大小上限（位元組）
    max_upload_bytes: int = 10 * 1024 * 1024
    # 每位使用者每日上傳檔案數上限
    user_daily_upload_limit: int = 20
    # 每位使用者每分鐘 AI 請求上限
    user_rpm_limit: int = 10
    # 全站每分鐘 AI 請求上限，保護 Gemini 免費層 RPM
    global_rpm_limit: int = 30

    # ---------- 其他 ----------
    # CORS 白名單，逗號分隔的字串，於 main.py 轉成清單
    cors_allowed_origins: str = "http://localhost:3000"

    @field_validator("*", mode="before")
    @classmethod
    def _clean_string_values(cls, value: Any) -> Any:
        # 只處理字串，其他型別（整數、清單）原樣回傳
        if isinstance(value, str):
            # 去除前後空白，並移除編輯器可能自動插入的換行，避免 502 驗證失敗
            return value.strip().replace("\n", "").replace("\r", "")
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        # 把逗號分隔字串拆成清單，並去掉空白與空字串
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


# 整個應用程式共用同一個設定實例
settings = Settings()
