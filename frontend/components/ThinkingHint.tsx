// frontend/components/ThinkingHint.tsx
'use client';

// 「AI 思考中」提示：等待第一個字時顯示，依等待秒數切換文字，讓使用者知道系統仍在運作。
import { useEffect, useState } from 'react';
import { useApp } from '@/components/Providers';

// 外層的 role="status" 常駐在 DOM 中，螢幕閱讀器才能朗讀之後插入的文字；active 為 false 時內容為空，由 empty:hidden 隱藏
export function ThinkingHint({ active }: { active: boolean }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {active && <ThinkingIndicator />}
    </div>
  );
}

// 只有在 active 時才掛載，因此每次開始等待時秒數都會從 0 重新計算
function ThinkingIndicator() {
  const { t } = useApp();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // 記下開始時間，每秒以實際經過時間更新，避免計時器漂移
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // 等待越久，提示文字越明確；超過 30 秒提醒使用者可以按停止
  const stageKey = elapsed >= 30 ? 'thinking.slow' : elapsed >= 10 ? 'thinking.longer' : 'thinking.start';

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      {/* 三個跳動的點純屬裝飾，對螢幕閱讀器隱藏；減少動態偏好時 motion-safe 會停止動畫 */}
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 rounded-full bg-zinc-500 motion-safe:animate-bounce dark:bg-zinc-400"
            style={{ animationDelay: `${dot * 150}ms` }}
          />
        ))}
      </span>
      <span>{t(stageKey)}</span>
      {/* 秒數只給視覺使用；螢幕閱讀器不需要每秒朗讀一次 */}
      <span aria-hidden="true" className="text-xs tabular-nums">
        {elapsed}s
      </span>
    </div>
  );
}
