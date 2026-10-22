// frontend/components/AuthGate.tsx
'use client';

// 登入閘門：依 Supabase session 決定顯示骨架屏、登入面板或實際頁面內容。
import { useEffect, useState, type ReactNode } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthPanel } from '@/components/AuthPanel';
import { Skeleton } from '@/components/Skeleton';
import { getSupabase } from '@/lib/supabase';

export function AuthGate({ children }: { children: ReactNode }) {
  // undefined 代表還在確認登入狀態，null 代表未登入，Session 代表已登入
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const supabase = getSupabase();
    // 初次載入時主動讀取目前 session（會自動從 cookie 還原）
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // 之後登入、登出或 token 更新時，同步更新狀態
    // 回呼參數要明確標註型別：Supabase 這個方法有多載，TypeScript 無法自動推斷參數型別
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, next: Session | null) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  // 還在確認時顯示骨架屏，避免畫面閃爍
  if (session === undefined) {
    return <Skeleton lines={4} />;
  }
  // 未登入時顯示登入面板，不渲染任何需要權限的頁面內容
  if (session === null) {
    return <AuthPanel />;
  }
  // 已登入才渲染實際頁面
  return <>{children}</>;
}
