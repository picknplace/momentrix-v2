'use client';

import { Button } from './ui/button';

interface TopbarProps {
  userName?: string;
  userRole?: string;
}

export function Topbar({ userName, userRole }: TopbarProps) {
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <header className="flex items-center justify-between h-10 px-4 bg-mx-topbar border-b border-mx-border">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-mx-text">Momentrix</span>
        <a href="/report" target="_blank" className="text-xs text-mx-text-muted hover:text-mx-cyan">
          리포트
        </a>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-mx-text-secondary">
          {userName} ({userRole})
        </span>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          로그아웃
        </Button>
      </div>
    </header>
  );
}
