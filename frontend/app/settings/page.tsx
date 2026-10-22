// frontend/app/settings/page.tsx
'use client';

// 提示詞與設定頁：伺服器同步的 Prompt 草稿、Prompt 提示詞庫的增刪改、語言與主題切換、環境與用量狀態。
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { useApp } from '@/components/Providers';
import { Skeleton } from '@/components/Skeleton';
import { apiErrorKey, apiFetch } from '@/lib/api';
import { getSupabase } from '@/lib/supabase';
import { writeLocal } from '@/lib/prefs';

// 草稿在伺服器上的自動儲存延遲（毫秒）
const DRAFT_SAVE_DELAY_MS = 1000;
// 首頁對話使用的草稿快取 key，與首頁 app/page.tsx 相同
const CHAT_DRAFT_KEY = 'draft:chat';

// 後端 /api/prompts 回傳的提示詞
type Prompt = { id: string; title: string; body: string; created_at: string; updated_at: string };
// 後端 /api/status 回傳的環境與用量資訊
type StatusData = {
  gemini_key_configured: boolean;
  database_configured: boolean;
  ollama_model: string;
  usage_today: { tokens: number; uploads: number; requests: number };
  limits: { user_daily_tokens: number; user_daily_uploads: number; user_rpm: number };
};
// 草稿自動儲存的狀態
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export default function SettingsPage() {
  const { t, locale, theme, setLocale, setTheme } = useApp();
  // 表單欄位的 id，用來做 label 關聯
  const draftId = useId();
  const titleId = useId();
  const bodyId = useId();
  const deleteDescId = useId();

  // ---- Prompt 草稿（伺服器同步）----
  // 草稿內容
  const [draft, setDraft] = useState('');
  // 是否已從伺服器載入完成；載入前不自動儲存，避免用空字串覆蓋伺服器上的內容
  const [draftLoaded, setDraftLoaded] = useState(false);
  // 草稿儲存狀態
  const [draftState, setDraftState] = useState<SaveState>('idle');
  // 記錄最後一次成功儲存的內容，只有內容真的改變時才送出儲存請求
  const lastSavedRef = useRef('');

  // ---- Prompt 提示詞庫 ----
  // 提示詞列表：null 代表載入中
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  // 正在編輯的提示詞 id，null 代表新增模式
  const [editingId, setEditingId] = useState<string | null>(null);
  // 表單的標題與內容
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  // 表單儲存中狀態
  const [saving, setSaving] = useState(false);
  // 等待確認刪除的提示詞，null 代表沒有開啟刪除對話框
  const [deleteTarget, setDeleteTarget] = useState<Prompt | null>(null);

  // ---- 環境與用量 ----
  // 狀態資料：null 代表載入中
  const [status, setStatus] = useState<StatusData | null>(null);

  // 掛載時同時載入草稿、提示詞庫與環境狀態
  useEffect(() => {
    loadDraft();
    loadPrompts();
    loadStatus();
  }, []);

  // 草稿自動儲存：內容變動後等 1 秒，若期間又有變動就取消重排，減少請求次數
  useEffect(() => {
    if (!draftLoaded || draft === lastSavedRef.current) return;
    setDraftState('saving');
    const timer = setTimeout(async () => {
      try {
        await apiFetch('/api/prompts/draft', { method: 'PUT', body: { body: draft } });
        lastSavedRef.current = draft;
        setDraftState('saved');
      } catch {
        setDraftState('failed');
      }
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, draftLoaded]);

  // 從伺服器讀取草稿
  async function loadDraft() {
    try {
      const res = await apiFetch<{ body: string }>('/api/prompts/draft');
      setDraft(res.body);
      lastSavedRef.current = res.body;
    } catch (err) {
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    } finally {
      // 不論成功與否都標記為已載入，失敗時使用空草稿，但不會自動覆蓋（內容未變動就不會儲存）
      setDraftLoaded(true);
    }
  }

  // 從伺服器讀取提示詞庫
  async function loadPrompts() {
    try {
      setPrompts(await apiFetch<Prompt[]>('/api/prompts'));
    } catch (err) {
      setPrompts([]);
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    }
  }

  // 從伺服器讀取環境與用量狀態
  async function loadStatus() {
    try {
      setStatus(await apiFetch<StatusData>('/api/status'));
    } catch (err) {
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    }
  }

  // 清空表單並回到新增模式
  function resetForm() {
    setEditingId(null);
    setFormTitle('');
    setFormBody('');
  }

  // 進入編輯模式：把選中的提示詞帶入表單
  function startEdit(prompt: Prompt) {
    setEditingId(prompt.id);
    setFormTitle(prompt.title);
    setFormBody(prompt.body);
  }

  // 新增或更新提示詞：有 editingId 就 PUT，否則 POST
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = formTitle.trim();
    const body = formBody.trim();
    if (!title || !body || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/api/prompts/${editingId}`, { method: 'PUT', body: { title, body } });
      } else {
        await apiFetch('/api/prompts', { method: 'POST', body: { title, body } });
      }
      toast.success(t('settings.saved'));
      resetForm();
      await loadPrompts();
    } catch (err) {
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    } finally {
      setSaving(false);
    }
  }

  // 使用者確認刪除後才真正呼叫後端
  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await apiFetch(`/api/prompts/${target.id}`, { method: 'DELETE' });
      toast.success(t('settings.deleted'));
      // 如果正在編輯被刪除的那一筆，同時清空表單
      if (editingId === target.id) resetForm();
      await loadPrompts();
    } catch (err) {
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    }
  }

  // 把提示詞內容套用到首頁對話的草稿快取，之後到首頁就能直接使用
  function useInChat(prompt: Prompt) {
    writeLocal(CHAT_DRAFT_KEY, prompt.body);
    toast.success(t('settings.useDone'));
  }

  // 草稿狀態轉成文字
  const draftStateText =
    draftState === 'saving' ? t('common.saving') : draftState === 'saved' ? t('common.saved') : draftState === 'failed' ? t('common.saveFailed') : '';

  // 登出所有裝置：scope 為 global，會撤銷此帳號所有 refresh token，包含目前這台裝置
  async function signOutAllDevices() {
    const { error } = await getSupabase().auth.signOut({ scope: 'global' });
    if (error) {
      toast.error(t('err.generic'));
      return;
    }
    toast.success(t('settings.signOutAllDone'));
  }

  return (
    <div className="space-y-10">
      {/* 語言與外觀設定：aria-pressed 表示目前選中的選項 */}
      <section aria-labelledby="prefs-title" className="space-y-4">
        <h2 id="prefs-title" className="text-xl font-semibold">
          {t('settings.title')}
        </h2>

        <div className="flex flex-wrap items-center gap-6">
          <div className="space-y-2">
            <span className="block text-sm font-medium" id="lang-group-label">
              {t('settings.language')}
            </span>
            <div role="group" aria-labelledby="lang-group-label" className="flex gap-2">
              <button
                type="button"
                aria-pressed={locale === 'zh-TW'}
                onClick={() => setLocale('zh-TW')}
                className={`rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  locale === 'zh-TW' ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                繁體中文
              </button>
              <button
                type="button"
                aria-pressed={locale === 'en'}
                onClick={() => setLocale('en')}
                className={`rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  locale === 'en' ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                English
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-medium" id="theme-group-label">
              {t('settings.theme')}
            </span>
            <div role="group" aria-labelledby="theme-group-label" className="flex gap-2">
              <button
                type="button"
                aria-pressed={theme === 'light'}
                onClick={() => setTheme('light')}
                className={`rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  theme === 'light' ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                {t('common.themeLight')}
              </button>
              <button
                type="button"
                aria-pressed={theme === 'dark'}
                onClick={() => setTheme('dark')}
                className={`rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  theme === 'dark' ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                {t('common.themeDark')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Prompt 草稿：伺服器自動儲存 */}
      <section aria-labelledby="draft-title" className="space-y-3">
        <h2 id="draft-title" className="text-lg font-semibold">
          {t('settings.draft')}
        </h2>
        <label htmlFor={draftId} className="sr-only">
          {t('settings.draftLabel')}
        </label>
        <textarea
          id={draftId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!draftLoaded}
          aria-describedby={`${draftId}-hint`}
          rows={6}
          maxLength={20000}
          className="w-full resize-y rounded border border-zinc-300 bg-transparent p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 dark:border-zinc-700"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={`${draftId}-hint`} className="text-xs text-zinc-600 dark:text-zinc-400">
            {t('settings.draftHint')}
          </p>
          {/* 草稿狀態用 role="status"，儲存完成時螢幕閱讀器會朗讀 */}
          <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">
            {draftStateText}
          </p>
        </div>
      </section>

      {/* Prompt 提示詞庫：新增、編輯、刪除、套用到首頁對話 */}
      <section aria-labelledby="library-title" className="space-y-4">
        <h2 id="library-title" className="text-lg font-semibold">
          {t('settings.library')}
        </h2>

        <form onSubmit={handleSubmit} aria-busy={saving} className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-base font-medium">{editingId ? t('settings.formEdit') : t('settings.formCreate')}</h3>
          <div className="space-y-1">
            <label htmlFor={titleId} className="block text-sm font-medium">
              {t('settings.titleLabel')}
            </label>
            <input
              id={titleId}
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              required
              maxLength={100}
              className="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={bodyId} className="block text-sm font-medium">
              {t('settings.bodyLabel')}
            </label>
            <textarea
              id={bodyId}
              value={formBody}
              onChange={(e) => setFormBody(e.target.value)}
              required
              rows={4}
              maxLength={20000}
              className="w-full resize-y rounded border border-zinc-300 bg-transparent p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving ? t('common.saving') : editingId ? t('common.save') : t('common.create')}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded border border-zinc-300 px-4 py-2 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('settings.cancelEdit')}
              </button>
            )}
          </div>
        </form>

        {prompts === null ? (
          <Skeleton lines={3} />
        ) : prompts.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('settings.libraryEmpty')}</p>
        ) : (
          <ul className="space-y-3">
            {prompts.map((prompt) => (
              <li key={prompt.id} className="space-y-2 rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="font-medium break-words">{prompt.title}</h3>
                <p className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">{prompt.body}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => useInChat(prompt)}
                    aria-label={`${t('settings.use')}：${prompt.title}`}
                    className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {t('settings.use')}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(prompt)}
                    aria-label={`${t('common.edit')}：${prompt.title}`}
                    className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(prompt)}
                    aria-label={`${t('common.delete')}：${prompt.title}`}
                    className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 刪除確認對話框：Radix Dialog，role 改為 alertdialog，讓螢幕閱讀器把它當成需要立即回應的警示 */}
      <Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content
            role="alertdialog"
            aria-describedby={deleteDescId}
            className="fixed left-1/2 top-1/2 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg bg-white p-6 shadow-lg dark:bg-zinc-900"
          >
            <Dialog.Title className="text-lg font-semibold">{t('settings.deleteTitle')}</Dialog.Title>
            <Dialog.Description id={deleteDescId} className="text-sm text-zinc-600 dark:text-zinc-400">
              {t('settings.deleteBody')}
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              {/* 取消按鈕：asChild 讓 Radix 把關閉行為綁到我們的 button 上 */}
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-4 py-2 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {t('common.cancel')}
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={confirmDelete}
                className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {t('settings.confirmDelete')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 環境與用量狀態：只顯示是否已設定，不顯示任何金鑰內容 */}
      <section aria-labelledby="env-title" className="space-y-3">
        <h2 id="env-title" className="text-lg font-semibold">
          {t('settings.env')}
        </h2>
        {status === null ? (
          <Skeleton lines={4} />
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="font-medium">{t('settings.envGemini')}</dt>
              <dd>{status.gemini_key_configured ? t('settings.envConfigured') : t('settings.envMissing')}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="font-medium">{t('settings.envDatabase')}</dt>
              <dd>{status.database_configured ? t('settings.envConfigured') : t('settings.envMissing')}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="font-medium">{t('settings.envOllama')}</dt>
              <dd className="break-all">{status.ollama_model}</dd>
            </div>
            <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="font-medium">{t('settings.usage')}</dt>
              <dd className="space-y-1">
                <p>{t('settings.usageTokens', { used: status.usage_today.tokens, limit: status.limits.user_daily_tokens })}</p>
                <p>{t('settings.usageUploads', { used: status.usage_today.uploads, limit: status.limits.user_daily_uploads })}</p>
                <p>{t('settings.usageRpm', { limit: status.limits.user_rpm })}</p>
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* 帳號與登出：全部裝置登出是獨立功能，因為會連同目前這台裝置一起登出 */}
      <section aria-labelledby="account-title" className="space-y-3">
        <h2 id="account-title" className="text-lg font-semibold">
          {t('settings.account')}
        </h2>
        <p id="signout-all-hint" className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('settings.signOutAllHint')}
        </p>
        <button
          type="button"
          onClick={signOutAllDevices}
          aria-describedby="signout-all-hint"
          className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t('settings.signOutAll')}
        </button>
      </section>
    </div>
  );
}
