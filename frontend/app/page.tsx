// frontend/app/page.tsx
'use client';

// 首頁：核心對話介面。包含 AI 串流回答、歷史對話列表、草稿自動備份與 RAG 開關。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { useApp } from '@/components/Providers';
import MarkdownContent from '@/components/MarkdownContent';
import { Skeleton } from '@/components/Skeleton';
import { ThinkingHint } from '@/components/ThinkingHint';
import { apiErrorKey, apiFetch, streamSse } from '@/lib/api';
import { DEFAULT_TUNING, readLocal, readTuning, writeLocal, type TuningParams } from '@/lib/prefs';
import type { MessageKey } from '@/lib/i18n';

// 草稿在 localStorage 中的 key
const DRAFT_KEY = 'draft:chat';

// 後端 /api/conversations 回傳的對話摘要
type Conversation = { id: string; title: string; created_at: string; updated_at: string };
// 後端 /api/conversations/{id}/messages 回傳的單則訊息
type ServerMessage = { id: string; role: string; content: string; model: string | null; created_at: string };
// 畫面上的一則訊息（只需要角色與文字）
type ChatMessage = { role: 'user' | 'assistant'; content: string };

export default function ChatPage() {
  // 取得翻譯函式
  const { t } = useApp();
  // 歷史對話列表：null 代表還在載入
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  // 目前開啟的對話 id，null 代表新對話
  const [activeId, setActiveId] = useState<string | null>(null);
  // 目前畫面上的訊息
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 輸入框內容：初始值直接從草稿快取讀取，讓重新整理後草稿不會消失
  const [input, setInput] = useState(() => readLocal(DRAFT_KEY) ?? '');
  // 是否開啟文件參考（RAG）
  const [useKnowledge, setUseKnowledge] = useState(false);
  // 是否正在等待 AI 回答
  const [sending, setSending] = useState(false);
  // 是否還在等待第一個字（顯示「AI 思考中」提示用）
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  // 螢幕閱讀器用的狀態「翻譯鍵」，渲染時才翻譯，切換語言後文字才會跟著更新；null 代表沒有狀態
  const [statusKey, setStatusKey] = useState<MessageKey | null>(null);
  // 目前調校參數，用來在畫面上顯示提示
  const [params, setParams] = useState<TuningParams>(DEFAULT_TUNING);
  // 用來中止目前串流的控制器
  const abortRef = useRef<AbortController | null>(null);

  // 掛載後載入歷史對話列表與調校參數（只在瀏覽器端執行）
  useEffect(() => {
    setParams(readTuning());
    loadConversations();
    // 元件卸載時中止還在進行的串流
    return () => abortRef.current?.abort();
    // loadConversations 只需要在掛載時執行一次
  }, []);

  // 草稿自動備份：輸入停止 500 毫秒後才寫入 localStorage，避免每個字都寫一次
  useEffect(() => {
    const timer = setTimeout(() => writeLocal(DRAFT_KEY, input), 500);
    return () => clearTimeout(timer);
  }, [input]);

  // 從伺服器重新載入對話列表
  async function loadConversations() {
    try {
      const rows = await apiFetch<Conversation[]>('/api/conversations');
      setConversations(rows);
    } catch (err) {
      setConversations([]);
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    }
  }

  // 開啟某個歷史對話，載入它的所有訊息
  async function openConversation(id: string) {
    // 串流進行中不允許切換對話，避免訊息錯位
    if (sending) return;
    try {
      const rows = await apiFetch<ServerMessage[]>(`/api/conversations/${id}/messages`);
      setActiveId(id);
      // 只保留 user 與 assistant 角色，忽略其他角色
      setMessages(rows.filter((r) => r.role === 'user' || r.role === 'assistant').map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content })));
    } catch (err) {
      toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
    }
  }

  // 開始新對話：清空畫面，下次送出時後端會建立新的對話
  function startNewChat() {
    if (sending) return;
    setActiveId(null);
    setMessages([]);
    setStatusKey(null);
  }

  // 停止目前的 AI 回答
  function stopAnswer() {
    abortRef.current?.abort();
  }

  // 送出訊息並以串流方式接收回答
  async function send() {
    // 去除前後空白，空白訊息或正在回答時不送出
    const text = input.trim();
    if (!text || sending) return;

    // 每次送出前重新讀取調校參數，確保使用最新設定
    const current = readTuning();
    setParams(current);

    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setInput('');
    setStatusKey(null);
    setAwaitingFirstToken(true);
    // 先把使用者訊息與一則空的 AI 回答放進畫面，之後的 token 會逐字填進空白回答
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);

    // 記錄這次是否為新對話，用來決定要不要重新整理列表
    const startedAsNew = activeId === null;
    let conversationId = activeId;
    let receivedAnyToken = false;

    try {
      await streamSse(
        '/api/chat/stream',
        {
          conversation_id: activeId,
          message: text,
          temperature: current.temperature,
          max_tokens: current.maxTokens,
          use_knowledge: useKnowledge,
        },
        (ev) => {
          // 後端事件：meta 給對話 id，token 給文字片段，done 表示完成，error 表示失敗
          if (ev.event === 'meta') {
            const data = ev.data as { conversation_id: string };
            conversationId = data.conversation_id;
            setActiveId(data.conversation_id);
          } else if (ev.event === 'token') {
            const data = ev.data as { text: string };
            receivedAnyToken = true;
            setAwaitingFirstToken(false);
            // 只更新最後一則（AI 回答）的內容，把新片段接在後面
            setMessages((prev) => {
              const copy = prev.slice();
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: last.content + data.text };
              return copy;
            });
          } else if (ev.event === 'done') {
            setStatusKey('chat.done');
          } else if (ev.event === 'error') {
            // 不直接顯示後端的原始錯誤文字，改用統一的多語系訊息；同時清除「回答中」的狀態文字
            setStatusKey(null);
            toast.error(t('err.server'));
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) {
        setStatusKey('chat.stopped');
        toast.message(t('chat.stopped'));
      } else {
        // 失敗時清除「回答中」的狀態文字，避免螢幕閱讀器持續朗讀
        setStatusKey(null);
        toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
      }
    } finally {
      // 若一個字都沒收到，就把空白的 AI 回答泡泡移除，避免畫面留下空框
      if (!receivedAnyToken) {
        setMessages((prev) => (prev.length && prev[prev.length - 1].role === 'assistant' && prev[prev.length - 1].content === '' ? prev.slice(0, -1) : prev));
      }
      setSending(false);
      setAwaitingFirstToken(false);
      abortRef.current = null;
      // 新對話成功建立後，重新整理歷史列表讓它出現在側邊欄
      if (startedAsNew && conversationId) {
        void loadConversations();
      }
    }
  }

  // 鍵盤處理：Enter 送出，Shift + Enter 換行；使用輸入法組字時（isComposing）不送出
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      {/* 歷史對話側邊欄 */}
      <aside aria-labelledby="history-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="history-title" className="text-base font-semibold">
            {t('chat.history')}
          </h2>
          <button
            type="button"
            onClick={startNewChat}
            disabled={sending}
            aria-label={t('chat.newChat')}
            className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {t('chat.newChat')}
          </button>
        </div>

        {conversations === null ? (
          <Skeleton lines={5} />
        ) : conversations.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('chat.historyEmpty')}</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {conversations.map((conv) => (
              <li key={conv.id}>
                {/* aria-current 標示目前開啟的對話 */}
                <button
                  type="button"
                  onClick={() => openConversation(conv.id)}
                  disabled={sending}
                  aria-current={conv.id === activeId ? 'true' : undefined}
                  className={`w-full truncate rounded px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 ${
                    conv.id === activeId ? 'bg-zinc-200 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                  }`}
                >
                  {conv.title || t('chat.untitled')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* 對話主區域 */}
      <section aria-labelledby="chat-title" className="flex min-h-[70vh] flex-col gap-4">
        <h2 id="chat-title" className="text-xl font-semibold">
          {t('chat.title')}
        </h2>

        {/* 訊息紀錄：role="log" 加上 aria-live，新增的訊息會被螢幕閱讀器朗讀 */}
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={t('chat.title')}
          className="flex-1 space-y-4 overflow-y-auto rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('chat.noMessages')}</p>
          ) : (
            messages.map((msg, index) => (
              <article key={index} aria-label={msg.role === 'user' ? t('chat.you') : t('chat.assistant')} className="space-y-1">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  {msg.role === 'user' ? t('chat.you') : t('chat.assistant')}
                </p>
                {/* 使用者輸入維持純文字；AI 回答以 Markdown 排版，且不解析原始 HTML，避免注入攻擊 */}
                {msg.role === 'assistant' ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.content}</div>
                )}
              </article>
            ))
          )}
        </div>

        {/* 等待第一個字時顯示「AI 思考中」提示；放在訊息紀錄外面，避免和 role="log" 重複朗讀 */}
        <ThinkingHint active={awaitingFirstToken} />

        {/* 螢幕閱讀器專用的狀態提示，畫面上隱藏 */}
        <p role="status" className="sr-only">
          {statusKey ? t(statusKey) : ''}
        </p>

        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {t('chat.paramsHint', { temperature: params.temperature, maxTokens: params.maxTokens })}
        </p>

        {/* 輸入區：文字框、RAG 開關與送出 / 停止按鈕 */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="space-y-3"
        >
          <label htmlFor="chat-input" className="sr-only">
            {t('chat.inputLabel')}
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            aria-describedby="chat-hint"
            rows={3}
            maxLength={8000}
            className="w-full resize-y rounded border border-zinc-300 bg-transparent p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700"
          />
          <p id="chat-hint" className="text-xs text-zinc-600 dark:text-zinc-400">
            {t('chat.hint')}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={useKnowledge}
                onChange={(e) => setUseKnowledge(e.target.checked)}
                aria-describedby="knowledge-hint"
                className="mt-0.5 h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
              />
              <span>
                {t('chat.useKnowledge')}
                <span id="knowledge-hint" className="block text-xs text-zinc-600 dark:text-zinc-400">
                  {t('chat.useKnowledgeHint')}
                </span>
              </span>
            </label>

            {sending ? (
              <button
                type="button"
                onClick={stopAnswer}
                aria-label={t('chat.stop')}
                className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {t('chat.stop')}
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {t('chat.send')}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
