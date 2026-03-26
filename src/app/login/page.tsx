'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Step = 'login' | 'otp' | 'done';

export default function LoginPage() {
  const [step, setStep] = useState<Step>('login');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, password }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || '로그인 실패'); return; }
      setStep('otp');
    } catch {
      setError('서버 오류');
    } finally {
      setLoading(false);
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, otp_code: otp }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || 'OTP 인증 실패'); return; }
      window.location.href = '/dashboard';
    } catch {
      setError('서버 오류');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-mx-bg">
      <Card className="w-full max-w-[360px]">
        <h1 className="text-xl font-bold text-center mb-6">Momentrix V2</h1>

        {step === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">아이디</label>
              <input
                type="text"
                value={userId}
                onChange={e => setUserId(e.target.value)}
                className="w-full px-3 py-2 bg-mx-bg border border-mx-border rounded text-mx-text focus:border-mx-blue focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-mx-bg border border-mx-border rounded text-mx-text focus:border-mx-blue focus:outline-none"
                required
              />
            </div>
            {error && <p className="text-sm text-mx-red">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleOtp} className="space-y-4">
            <p className="text-sm text-mx-text-secondary text-center">
              등록된 이메일로 인증번호를 발송했습니다
            </p>
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">인증번호 (6자리)</label>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                maxLength={6}
                className="w-full px-3 py-2 bg-mx-bg border border-mx-border rounded text-mx-text text-center text-lg tracking-widest focus:border-mx-blue focus:outline-none"
                required
              />
            </div>
            {error && <p className="text-sm text-mx-red">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? '인증 중...' : '인증 확인'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
