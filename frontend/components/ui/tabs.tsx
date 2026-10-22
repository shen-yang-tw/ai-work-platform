// frontend/components/ui/tabs.tsx
'use client';

// shadcn/ui 的 Tabs 元件（底層為 Radix UI Tabs，內建 role="tablist"、方向鍵切換與焦點管理）。
// 這裡採用 shadcn 的 line 樣式：選中的頁籤在下方顯示底線，並改用本專案的 zinc 色票。
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

// Tabs 根節點：負責記住目前選中的頁籤值
function Tabs({ className = '', ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={`flex flex-col ${className}`} {...props} />;
}

// 頁籤列：底部有一條淡色邊線，選中的頁籤底線會疊在這條線上
function TabsList({ className = '', ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={`inline-flex w-full items-center gap-6 border-b border-zinc-200 dark:border-zinc-800 ${className}`}
      {...props}
    />
  );
}

// 單一頁籤按鈕：未選中為灰字；選中時文字變深，並用 after 偽元素畫出底線
function TabsTrigger({ className = '', ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={`relative whitespace-nowrap px-1 pb-3 pt-1 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-60 data-[state=active]:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-zinc-400 dark:hover:text-zinc-100 dark:data-[state=active]:text-zinc-100 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-zinc-900 after:opacity-0 data-[state=active]:after:opacity-100 dark:after:bg-zinc-100 ${className}`}
      {...props}
    />
  );
}

// 頁籤內容：對應某個頁籤被選中時要顯示的區塊
function TabsContent({ className = '', ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={`flex-1 outline-none ${className}`} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
