'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const runtime = 'edge';

type Step = 'login' | 'otp' | 'signup';

export default function LoginPage() {
  const [step, setStep] = useState<Step>('login');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  // Signup fields
  const [signupForm, setSignupForm] = useState({ user_id: '', password: '', email: '', name: '' });

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
      setInfo(data.message || '');
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

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupForm),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || '가입 실패'); return; }
      setInfo(data.message || '가입 신청 완료');
      setStep('login');
    } catch {
      setError('서버 오류');
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'w-full px-3 py-2 bg-mx-bg border border-mx-border rounded text-mx-text focus:border-mx-blue focus:outline-none';

  return (
    <div className="min-h-screen flex items-center justify-center bg-mx-bg">
      <Card className="w-full max-w-[360px]">
        <h1 className="text-xl font-bold text-center mb-6 text-mx-text">Momentrix</h1>

        {step === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">아이디</label>
              <input type="text" value={userId} onChange={e => setUserId(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">비밀번호</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} required />
            </div>
            {error && <p className="text-sm text-mx-red">{error}</p>}
            {info && <p className="text-sm text-green-400">{info}</p>}
            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? '로그인 중...' : '로그인'}
            </Button>
            <p className="text-center text-xs text-mx-text-muted">
              계정이 없으신가요?{' '}
              <button type="button" className="text-mx-cyan hover:underline" onClick={() => { setStep('signup'); setError(''); setInfo(''); }}>
                가입 신청
              </button>
            </p>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleOtp} className="space-y-4">
            <p className="text-sm text-mx-text-secondary text-center">{info || '등록된 이메일로 인증번호를 발송했습니다'}</p>
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">인증번호 (6자리)</label>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                maxLength={6}
                className={`${inputCls} text-center text-lg tracking-widest`}
                required
              />
            </div>
            {error && <p className="text-sm text-mx-red">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? '인증 중...' : '인증 확인'}
            </Button>
            <p className="text-center text-xs text-mx-text-muted">
              <button type="button" className="text-mx-cyan hover:underline" onClick={() => { setStep('login'); setError(''); setOtp(''); }}>
                다시 로그인
              </button>
            </p>
          </form>
        )}

        {step === 'signup' && (
          <form onSubmit={handleSignup} className="space-y-3">
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">아이디</label>
              <input type="text" required className={inputCls} value={signupForm.user_id} onChange={e => setSignupForm({ ...signupForm, user_id: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">비밀번호</label>
              <input type="password" required className={inputCls} value={signupForm.password} onChange={e => setSignupForm({ ...signupForm, password: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">이름</label>
              <input type="text" required className={inputCls} value={signupForm.name} onChange={e => setSignupForm({ ...signupForm, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-mx-text-secondary mb-1">이메일</label>
              <input type="email" required className={inputCls} value={signupForm.email} onChange={e => setSignupForm({ ...signupForm, email: e.target.value })} />
            </div>
            {error && <p className="text-sm text-mx-red">{error}</p>}
            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? '처리 중...' : '가입 신청'}
            </Button>
            <p className="text-center text-xs text-mx-text-muted">
              <button type="button" className="text-mx-cyan hover:underline" onClick={() => { setStep('login'); setError(''); }}>
                로그인으로 돌아가기
              </button>
            </p>
          </form>
        )}
      </Card>
    </div>
  );
}
