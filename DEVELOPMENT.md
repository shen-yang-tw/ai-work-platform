# 本機開發與上線

## 預先安裝（每台電腦一樣）

Docker（Windows 為 Docker Desktop）、Node.js 22+、Python 3。Supabase CLI 缺少時，腳本會自動執行 
pm install -g supabase 安裝。

## 唯一的指令

- Windows 11：`py -3 scripts/workflow.py`
- Ubuntu：`python3 scripts/workflow.py`

第一次執行會自動建立 `.env`、從本機 Supabase 填入網址與金鑰、安裝前端依賴，只會詢問一次 Gemini API 金鑰。

## 流程

- 輸入 `yes`：啟動本機 Supabase、Next.js 開發伺服器與 FastAPI 自動重載。完成後輸入 `end`。
- `end`：前端型別檢查與 build、Gemini 串流與 1536 維 Embedding 測試、Docker production image build；全部通過後自動 commit 並推上 GitHub。
- 第一次 `end` 時會問「這台是不是家裡伺服器」並記在已忽略的 `.machine.env`。若是伺服器，會接著直接在本機上線（compose up、Ollama 模型、健康檢查）。
- 在學院等非伺服器電腦：`end` 只推上 GitHub。回家後在伺服器執行同一指令，輸入 `deploy`，會 `git pull` 並上線。

任何步驟失敗都會停止。流程不會執行資料庫刪除、重設或移除 Docker volumes 的命令，也不會提交 `.env`。