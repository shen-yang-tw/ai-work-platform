// frontend/components/Skeleton.tsx
'use client';

// 骨架屏：資料載入中顯示灰色脈動區塊，減少版面跳動（CLS）並告知使用者正在載入
import { useApp } from '@/components/Providers';

// lines 代表要顯示幾條骨架列，預設 3 條
export function Skeleton({ lines = 3 }: { lines?: number }) {
  // 取得翻譯函式，讓 sr-only 的載入提示跟著語言切換
  const { t } = useApp();
  return (
    // role="status" 讓螢幕閱讀器在內容更新時朗讀狀態，aria-live="polite" 等目前語句結束再念
    <div role="status" aria-live="polite" className="space-y-3 p-4">
      {/* sr-only 只給螢幕閱讀器聽，畫面上看不到 */}
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: lines }, (_, index) => (
        // aria-hidden 讓裝飾用的灰條不被朗讀
        <div
          key={index}
          aria-hidden="true"
          className="h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
        />
      ))}
    </div>
  );
}
