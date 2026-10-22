// frontend/components/MarkdownContent.tsx
// 把 AI 回傳的 Markdown 文字轉成排版好的畫面（粗體、清單、程式碼區塊、表格等）。
'use client';

// 引入 Markdown 解析元件；它預設不會解析原始 HTML，所以 AI 輸出無法注入腳本
import ReactMarkdown from 'react-markdown';
// 引入 GFM 外掛，支援表格、刪除線與任務清單
import remarkGfm from 'remark-gfm';

// 元件參數：要顯示的 Markdown 文字
type MarkdownContentProps = { content: string };

// 各種 Markdown 元素對應的樣式；用 Tailwind 類別，同時支援淺色與深色模式
const components = {
  // 段落：上下留白，讓段落之間有呼吸空間
  p: (props: React.ComponentProps<'p'>) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  // 無序清單：加上圓點與縮排
  ul: (props: React.ComponentProps<'ul'>) => <ul className="my-2 list-disc space-y-1 pl-6" {...props} />,
  // 有序清單：加上數字與縮排
  ol: (props: React.ComponentProps<'ol'>) => <ol className="my-2 list-decimal space-y-1 pl-6" {...props} />,
  // 標題：統一用較小的粗體，避免在對話泡泡裡太大
  h1: (props: React.ComponentProps<'h1'>) => <h3 className="mb-2 mt-4 text-base font-bold first:mt-0" {...props} />,
  h2: (props: React.ComponentProps<'h2'>) => <h3 className="mb-2 mt-4 text-base font-bold first:mt-0" {...props} />,
  h3: (props: React.ComponentProps<'h3'>) => <h4 className="mb-1 mt-3 text-sm font-bold first:mt-0" {...props} />,
  // 粗體：維持語意上的 strong
  strong: (props: React.ComponentProps<'strong'>) => <strong className="font-semibold" {...props} />,
  // 連結：新分頁開啟並加上 noopener，避免被開啟的頁面控制原分頁
  a: (props: React.ComponentProps<'a'>) => (
    <a className="underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  // 引用區塊：左側加一條線
  blockquote: (props: React.ComponentProps<'blockquote'>) => (
    <blockquote className="my-2 border-l-4 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-600 dark:text-zinc-400" {...props} />
  ),
  // 程式碼區塊外框：可橫向捲動，鍵盤可聚焦以符合無障礙
  pre: (props: React.ComponentProps<'pre'>) => (
    <pre
      tabIndex={0}
      className="my-2 overflow-x-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-800"
      {...props}
    />
  ),
  // 行內程式碼：淺底色小字
  code: (props: React.ComponentProps<'code'>) => (
    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800" {...props} />
  ),
  // 表格：外層可橫向捲動，避免撐破版面
  table: (props: React.ComponentProps<'table'>) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: (props: React.ComponentProps<'th'>) => (
    <th className="border border-zinc-300 bg-zinc-100 px-2 py-1 font-semibold dark:border-zinc-600 dark:bg-zinc-800" {...props} />
  ),
  td: (props: React.ComponentProps<'td'>) => (
    <td className="border border-zinc-300 px-2 py-1 dark:border-zinc-600" {...props} />
  ),
};

// 對外元件：把 Markdown 字串渲染成排版後的內容
export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    // break-words 讓長字串自動換行；text-sm 與原本對話文字大小一致
    <div className="break-words text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}