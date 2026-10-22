// frontend/app/knowledge/page.tsx
'use client';

// 文件向量化管理頁：上傳 PDF / Markdown / TXT，一鍵匯入範例知識庫，並查看已上傳文件列表。
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useApp } from '@/components/Providers';
import { Skeleton } from '@/components/Skeleton';
import { apiErrorKey, apiFetch } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n';

// 單檔大小上限：10 MB，與後端一致
const MAX_BYTES = 10 * 1024 * 1024;
// 允許的副檔名，與後端 MIME 白名單對應
const ALLOWED_EXTENSIONS = ['.pdf', '.md', '.txt'];

// 後端 /api/knowledge/documents 回傳的文件資料
type DocumentRow = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  created_at: string;
};

// 文件狀態對應的多語系 key
const STATUS_KEYS: Record<string, MessageKey> = {
  processing: 'knowledge.status.processing',
  ready: 'knowledge.status.ready',
  failed: 'knowledge.status.failed',
};

// 把位元組數轉成易讀的 KB 或 MB 字串
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function KnowledgePage() {
  const { t } = useApp();
  // 檔案輸入框與說明文字的 id，用來做無障礙關聯
  const fileInputId = useId();
  const hintId = useId();
  // 指向檔案輸入框的參考，上傳後用來清空選擇
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 文件列表：null 代表還在載入
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  // 使用者目前選中的檔案
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // 上傳中狀態，避免重複送出
  const [uploading, setUploading] = useState(false);
  // 範例匯入中狀態
  const [seeding, setSeeding] = useState(false);
  // 螢幕閱讀器狀態提示：只存「翻譯鍵」與參數，渲染時才翻譯，切換語言後文字才會跟著更新
  const [status, setStatus] = useState<{
    key: MessageKey;
    params?: Record<string, string | number>;
    filename?: string;
  } | null>(null);

  // 掛載時載入文件列表
  useEffect(() => {
    void loadDocuments();
  }, []);

  // 從伺服器取得文件列表
  async function loadDocuments() {
    try {
      const rows = await apiFetch<DocumentRow[]>('/api/knowledge/documents');
      setDocuments(rows);
    } catch (err) {
      setDocuments([]);
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    }
  }

  // 使用者選擇檔案時：先在前端檢查副檔名與大小，不合格就直接提示，省去一次無謂的上傳
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    // 轉成小寫後比對副檔名
    const lower = file.name.toLowerCase();
    const extensionOk = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!extensionOk) {
      toast.error(t('knowledge.badType'));
      event.target.value = '';
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('err.tooLarge'));
      event.target.value = '';
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }

  // 上傳並向量化：以 FormData 送出，欄位名稱必須是 file
  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || uploading) return;
    setUploading(true);
    setStatus({ key: 'knowledge.uploading' });
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      const result = await apiFetch<{ id: string; filename: string; chunks: number }>('/api/knowledge/documents', {
        method: 'POST',
        body: form,
      });
      toast.success(t('knowledge.uploaded'));
      setStatus({ key: 'knowledge.uploaded', filename: result.filename });
      // 清空選擇，讓同一個檔案也能再次操作
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadDocuments();
    } catch (err) {
      // 失敗時同步更新狀態文字，避免螢幕閱讀器一直停在「上傳中」
      toast.error(t(apiErrorKey(err)));
      setStatus({ key: apiErrorKey(err) });
    } finally {
      setUploading(false);
    }
  }

  // 一鍵匯入範例知識庫：後端會跳過已存在的範例，所以重複按也安全
  async function handleSeed() {
    if (seeding) return;
    setSeeding(true);
    setStatus({ key: 'knowledge.seeding' });
    try {
      const result = await apiFetch<{ created: number; skipped: number }>('/api/knowledge/seed', { method: 'POST' });
      toast.success(t('knowledge.seedResult', { created: result.created, skipped: result.skipped }));
      setStatus({ key: 'knowledge.seedResult', params: { created: result.created, skipped: result.skipped } });
      await loadDocuments();
    } catch (err) {
      // 失敗時同步更新狀態文字，避免螢幕閱讀器一直停在「匯入中」
      toast.error(t(apiErrorKey(err)));
      setStatus({ key: apiErrorKey(err) });
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="knowledge-title" className="space-y-4">
        <h2 id="knowledge-title" className="text-xl font-semibold">
          {t('knowledge.title')}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('knowledge.description')}</p>

        {/* 上傳表單：送出時才真正呼叫後端 */}
        <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3" aria-busy={uploading}>
          <div className="space-y-1">
            <label htmlFor={fileInputId} className="block text-sm font-medium">
              {t('knowledge.fileLabel')}
            </label>
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
              onChange={handleFileChange}
              aria-describedby={hintId}
              className="block text-sm file:mr-3 file:rounded file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:file:border-zinc-700"
            />
            <p id={hintId} className="text-xs text-zinc-600 dark:text-zinc-400">
              {t('knowledge.badType')}
            </p>
          </div>
          <button
            type="submit"
            disabled={!selectedFile || uploading}
            className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {uploading ? t('knowledge.uploading') : t('knowledge.upload')}
          </button>
        </form>

        {/* 範例知識庫按鈕：方便第一次使用的人直接測試 RAG */}
        <div>
          <button
            type="button"
            onClick={handleSeed}
            disabled={seeding}
            className="rounded border border-zinc-300 px-4 py-2 hover:bg-zinc-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {seeding ? t('knowledge.seeding') : t('knowledge.seed')}
          </button>
        </div>

        {/* 螢幕閱讀器專用的狀態提示 */}
        <p role="status" className="sr-only">
          {status
            ? `${t(status.key, status.params)}${status.filename ? `：${status.filename}` : ''}`
            : ''}
        </p>
      </section>

      <section aria-labelledby="documents-title" className="space-y-3">
        <h2 id="documents-title" className="text-lg font-semibold">
          {t('knowledge.documents')}
        </h2>

        {documents === null ? (
          <Skeleton lines={4} />
        ) : documents.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('knowledge.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            {/* 表格有標題（caption）與欄位標題（th scope），方便螢幕閱讀器瀏覽 */}
            <table className="w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">{t('knowledge.documents')}</caption>
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th scope="col" className="py-2 pr-4 font-semibold">{t('knowledge.col.name')}</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">{t('knowledge.col.type')}</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">{t('knowledge.col.size')}</th>
                  <th scope="col" className="py-2 font-semibold">{t('knowledge.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const statusKey = STATUS_KEYS[doc.status];
                  return (
                    <tr key={doc.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 break-all">{doc.filename}</td>
                      <td className="py-2 pr-4">{doc.mime_type}</td>
                      <td className="py-2 pr-4">{formatSize(doc.size_bytes)}</td>
                      <td className="py-2">{statusKey ? t(statusKey) : doc.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
