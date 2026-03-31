'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export const runtime = 'edge';

interface User {
  user_id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator';
  status: 'pending' | 'active' | 'inactive';
  created_at: string;
  last_login: string | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const { toast } = useToast();

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.ok) setUsers(data.users);
      else toast(data.error || '조회 실패', 'error');
    } catch {
      toast('네트워크 오류', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleAction(action: string, targetUserId: string, extra?: Record<string, string>) {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target_user_id: targetUserId, ...extra }),
    });
    const data = await res.json();
    if (data.ok) {
      toast('완료', 'success');
      loadUsers();
    } else {
      toast(data.error || '실패', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-mx-text">사용자 관리</h2>
        <Button size="sm" onClick={() => setShowInvite(!showInvite)}>
          {showInvite ? '닫기' : '사용자 초대'}
        </Button>
      </div>

      {showInvite && <InviteForm onDone={() => { setShowInvite(false); loadUsers(); }} />}

      <Card>
        {loading ? (
          <p className="text-sm text-mx-text-muted p-4">로딩 중...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mx-border text-mx-text-secondary">
                  <th className="text-left px-3 py-2">아이디</th>
                  <th className="text-left px-3 py-2">이름</th>
                  <th className="text-left px-3 py-2">이메일</th>
                  <th className="text-left px-3 py-2">역할</th>
                  <th className="text-left px-3 py-2">상태</th>
                  <th className="text-left px-3 py-2">최근 로그인</th>
                  <th className="text-left px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.user_id} className="border-b border-mx-border-light hover:bg-mx-card-hover">
                    <td className="px-3 py-2 text-mx-text">{u.user_id}</td>
                    <td className="px-3 py-2 text-mx-text">{u.name}</td>
                    <td className="px-3 py-2 text-mx-text-secondary">{u.email}</td>
                    <td className="px-3 py-2">
                      <select
                        className="bg-mx-bg border border-mx-border rounded px-1 py-0.5 text-xs text-mx-text"
                        value={u.role}
                        onChange={e => handleAction('update_role', u.user_id, { role: e.target.value })}
                      >
                        <option value="operator">operator</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-3 py-2 text-mx-text-muted text-xs">
                      {u.last_login ? new Date(u.last_login).toLocaleString('ko-KR', { timeZone: 'Asia/Tokyo' }) : '-'}
                    </td>
                    <td className="px-3 py-2 flex gap-1">
                      {u.status === 'pending' && (
                        <Button size="sm" variant="success" onClick={() => handleAction('update_status', u.user_id, { status: 'active' })}>
                          승인
                        </Button>
                      )}
                      {u.status === 'active' && (
                        <Button size="sm" variant="warning" onClick={() => handleAction('update_status', u.user_id, { status: 'inactive' })}>
                          비활성화
                        </Button>
                      )}
                      {u.status === 'inactive' && (
                        <Button size="sm" variant="outline" onClick={() => handleAction('update_status', u.user_id, { status: 'active' })}>
                          활성화
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => {
                        const pw = prompt('새 비밀번호 입력:');
                        if (pw) handleAction('reset_password', u.user_id, { new_password: pw });
                      }}>
                        PW리셋
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = {
    active: 'bg-green-900/30 text-green-400 border-green-700',
    pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-700',
    inactive: 'bg-red-900/30 text-red-400 border-red-700',
  }[status] || 'bg-gray-900/30 text-gray-400 border-gray-700';

  return <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`}>{status}</span>;
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ user_id: '', password: '', email: '', name: '', role: 'operator' });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', ...form }),
      });
      const data = await res.json();
      if (data.ok) {
        toast('사용자 초대 완료', 'success');
        onDone();
      } else {
        toast(data.error || '실패', 'error');
      }
    } catch {
      toast('네트워크 오류', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 p-1">
        <input placeholder="아이디" required className="col-span-1 px-2 py-1.5 bg-mx-bg border border-mx-border rounded text-sm text-mx-text" value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })} />
        <input placeholder="비밀번호" required type="password" className="col-span-1 px-2 py-1.5 bg-mx-bg border border-mx-border rounded text-sm text-mx-text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <input placeholder="이름" required className="col-span-1 px-2 py-1.5 bg-mx-bg border border-mx-border rounded text-sm text-mx-text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input placeholder="이메일" required type="email" className="col-span-1 px-2 py-1.5 bg-mx-bg border border-mx-border rounded text-sm text-mx-text" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <select className="px-2 py-1.5 bg-mx-bg border border-mx-border rounded text-sm text-mx-text" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="operator">operator</option>
          <option value="admin">admin</option>
        </select>
        <Button type="submit" size="sm" disabled={loading}>{loading ? '처리 중...' : '초대'}</Button>
      </form>
    </Card>
  );
}
