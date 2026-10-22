// frontend/app/tuning/page.tsx
'use client';

// 模型參數調校頁：用 Radix 滑桿調整溫度與回答長度，並把同一個問題同時送給 Gemini 與 Ollama 做雙窗比較。
import { useEffect, useId, useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { toast } from 'sonner';
import { useApp } from '@/components/Providers';
import MarkdownContent from '@/components/MarkdownContent';
import { ThinkingHint } from '@/components/ThinkingHint';
import { apiErrorKey, streamSse } from '@/lib/api';
import { DEFAULT_TUNING, readTuning, writeTuning, type TuningParams } from '@/lib/prefs';
import type { MessageKey } from '@/lib/i18n';

// 單一側（左或右）的顯示狀態
type PaneState = {
  label: string;
  text: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
};

// 初始狀態：兩側都還沒有內容
const EMPTY_PANE: PaneState = { label: '', text: '', status: 'idle' };

// 把浮點數四捨五入到小數一位，避免滑桿產生 0.30000000000000004 這類數字
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export default function TuningPage() {
  const { t } = useApp();
  // 滑桿的無障礙說明文字 id
  const tempHelpId = useId();
  const tokenHelpId = useId();
  // 比較用問題輸入框的 id
  const promptId = useId();
  // 溫度與最大 Token 的目前值，初始使用預設值，掛載後再讀取使用者設定
  const [params, setParams] = useState<TuningParams>(DEFAULT_TUNING);
  // 比較用的問題
  const [question, setQuestion] = useState('');
  // 左右兩側的回答內容
  const [left, setLeft] = useState<PaneState>(EMPTY_PANE);
  const [right, setRight] = useState<PaneState>(EMPTY_PANE);
  // 是否正在比較
  const [comparing, setComparing] = useState(false);
  // 螢幕閱讀器狀態「翻譯鍵」，渲染時才翻譯，切換語言後文字才會跟著更新
  const [statusKey, setStatusKey] = useState<MessageKey | null>(null);
  // 用來中止比較串流
  const abortRef = useRef<AbortController | null>(null);

  // 掛載後讀取已儲存的調校參數
  useEffect(() => {
    setParams(readTuning());
    // 卸載時中止還在進行的比較
    return () => abortRef.current?.abort();
  }, []);

  // 更新參數並立刻寫入瀏覽器，下次開啟頁面或送出聊天時都會使用這組值
  function updateParams(next: TuningParams) {
    setParams(next);
    writeTuning(next);
  }

  // 停止比較
  function stopCompare() {
    abortRef.current?.abort();
  }

  // 同時把同一個問題送給兩個模型，後端以 side 欄位區分左右兩側的事件
  async function compare() {
    const message = question.trim();
    if (!message || comparing) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setComparing(true);
    setStatusKey('tuning.comparing');
    // 清空上一次的結果，並把兩側先標示為等待中
    setLeft({ ...EMPTY_PANE, status: 'streaming' });
    setRight({ ...EMPTY_PANE, status: 'streaming' });

    try {
      await streamSse(
        '/api/tuning/compare',
        { message, temperature: params.temperature, max_tokens: params.maxTokens },
        (ev) => {
          // meta：告訴前端左右兩側分別是哪個供應商與模型
          if (ev.event === 'meta') {
            const data = ev.data as { left: { provider: string; model: string }; right: { provider: string; model: string } };
            setLeft((prev) => ({ ...prev, label: `${data.left.provider} · ${data.left.model}` }));
            setRight((prev) => ({ ...prev, label: `${data.right.provider} · ${data.right.model}` }));
          } else if (ev.event === 'token') {
            // token：把文字片段接到指定的那一側
            const data = ev.data as { side: 'left' | 'right'; text: string };
            const update = (prev: PaneState) => ({ ...prev, text: prev.text + data.text });
            if (data.side === 'left') setLeft(update);
            else setRight(update);
          } else if (ev.event === 'error') {
            // error：某一側失敗時只標示該側，另一側仍可繼續顯示
            const data = ev.data as { side: 'left' | 'right' };
            const mark = (prev: PaneState) => ({ ...prev, status: 'error' as const });
            if (data.side === 'left') setLeft(mark);
            else setRight(mark);
            toast.error(t('err.server'));
          } else if (ev.event === 'end') {
            // end：某一側已完成輸出
            const data = ev.data as { side: 'left' | 'right' };
            const finish = (prev: PaneState) => (prev.status === 'error' ? prev : { ...prev, status: 'done' as const });
            if (data.side === 'left') setLeft(finish);
            else setRight(finish);
          } else if (ev.event === 'done') {
            setStatusKey('tuning.doneAll');
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) {
        toast.message(t('chat.stopped'));
      } else {
        toast.error(t(apiErrorKey(err)), { id: apiErrorKey(err) });
      }
    } finally {
      // 無論成功或失敗，都把還在 streaming 的一側改成完成狀態，避免畫面一直顯示轉圈
      setLeft((prev) => (prev.status === 'streaming' ? { ...prev, status: 'done' } : prev));
      setRight((prev) => (prev.status === 'streaming' ? { ...prev, status: 'done' } : prev));
      setComparing(false);
      abortRef.current = null;
    }
  }

  // 狀態轉成多語系文字，供每個窗格的 sr-only 狀態區使用
  function paneStatusText(pane: PaneState): string {
    if (pane.status === 'streaming') return t('tuning.waiting');
    if (pane.status === 'done') return t('tuning.finished');
    if (pane.status === 'error') return t('err.server');
    return '';
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="tuning-title" className="space-y-4">
        <h2 id="tuning-title" className="text-xl font-semibold">
          {t('tuning.title')}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('tuning.description')}</p>

        {/* 溫度滑桿：0 到 2，步進 0.1 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span id={`${tempHelpId}-label`} className="text-sm font-medium">
              {t('tuning.temperature')}
            </span>
            <output aria-live="off" className="text-sm tabular-nums">
              {params.temperature.toFixed(1)}
            </output>
          </div>
          <Slider.Root
            className="relative flex h-6 w-full touch-none select-none items-center"
            min={0}
            max={2}
            step={0.1}
            value={[params.temperature]}
            onValueChange={([v]) => updateParams({ ...params, temperature: round1(v) })}
            aria-labelledby={`${tempHelpId}-label`}
          >
            <Slider.Track className="relative h-2 grow rounded-full bg-zinc-200 dark:bg-zinc-800">
              <Slider.Range className="absolute h-full rounded-full bg-zinc-900 dark:bg-zinc-100" />
            </Slider.Track>
            {/* Thumb 會自動帶上 role="slider"，支援方向鍵與 Home、End 鍵操作 */}
            <Slider.Thumb
              aria-label={t('tuning.temperature')}
              className="block h-5 w-5 rounded-full border-2 border-zinc-900 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-100 dark:bg-zinc-900"
            />
          </Slider.Root>
          <p id={tempHelpId} className="text-xs text-zinc-600 dark:text-zinc-400">
            {t('tuning.temperatureHelp', { value: params.temperature.toFixed(1) })}
          </p>
        </div>

        {/* 最大回答長度滑桿：64 到 4096，步進 64 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span id={`${tokenHelpId}-label`} className="text-sm font-medium">
              {t('tuning.maxTokens')}
            </span>
            <output aria-live="off" className="text-sm tabular-nums">
              {params.maxTokens}
            </output>
          </div>
          <Slider.Root
            className="relative flex h-6 w-full touch-none select-none items-center"
            min={64}
            max={4096}
            step={64}
            value={[params.maxTokens]}
            onValueChange={([v]) => updateParams({ ...params, maxTokens: v })}
            aria-labelledby={`${tokenHelpId}-label`}
          >
            <Slider.Track className="relative h-2 grow rounded-full bg-zinc-200 dark:bg-zinc-800">
              <Slider.Range className="absolute h-full rounded-full bg-zinc-900 dark:bg-zinc-100" />
            </Slider.Track>
            <Slider.Thumb
              aria-label={t('tuning.maxTokens')}
              className="block h-5 w-5 rounded-full border-2 border-zinc-900 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-100 dark:bg-zinc-900"
            />
          </Slider.Root>
          <p id={tokenHelpId} className="text-xs text-zinc-600 dark:text-zinc-400">
            {t('tuning.maxTokensHelp', { value: params.maxTokens })}
          </p>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('tuning.saved')}</p>
      </section>

      <section aria-labelledby="compare-title" className="space-y-4">
        <h2 id="compare-title" className="text-lg font-semibold">
          {t('tuning.compare')}
        </h2>

        <div className="space-y-2">
          <label htmlFor={promptId} className="block text-sm font-medium">
            {t('tuning.promptLabel')}
          </label>
          <textarea
            id={promptId}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('tuning.promptPlaceholder')}
            rows={3}
            maxLength={8000}
            className="w-full resize-y rounded border border-zinc-300 bg-transparent p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700"
          />
          <div className="flex gap-2">
            {comparing ? (
              <button
                type="button"
                onClick={stopCompare}
                aria-label={t('tuning.stop')}
                className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                {t('tuning.stop')}
              </button>
            ) : (
              <button
                type="button"
                onClick={compare}
                disabled={!question.trim()}
                className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {t('tuning.compare')}
              </button>
            )}
          </div>
        </div>

        {/* 螢幕閱讀器專用的整體狀態提示 */}
        <p role="status" className="sr-only">
          {statusKey ? t(statusKey) : ''}
        </p>

        {/* 雙窗橫向對比：左右各一個窗格，手機版會上下堆疊 */}
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { side: 'left' as const, pane: left, fallback: t('tuning.leftDefault') },
            { side: 'right' as const, pane: right, fallback: t('tuning.rightDefault') },
          ].map(({ side, pane, fallback }) => (
            <section
              key={side}
              aria-label={pane.label || fallback}
              aria-busy={pane.status === 'streaming'}
              className="flex min-h-[240px] flex-col rounded border border-zinc-200 dark:border-zinc-800"
            >
              <h3 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">
                {pane.label || fallback}
              </h3>
              {/* 回答內容以 Markdown 排版，不解析原始 HTML */}
              <div className="flex-1 p-4">
                {pane.text ? <MarkdownContent content={pane.text} /> : null}
                {/* 串流中但還沒有任何文字時，顯示「AI 思考中」提示；收到第一個字後自動隱藏 */}
                <ThinkingHint active={pane.status === 'streaming' && pane.text === ''} />
              </div>
              {/* 每個窗格的狀態文字，給螢幕閱讀器使用 */}
              <p className="px-4 pb-3 text-xs text-zinc-600 dark:text-zinc-400">{paneStatusText(pane)}</p>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
