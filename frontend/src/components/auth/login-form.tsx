'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  AnalyticsIconBackdrop,
  LoginInfoCarousel,
} from '@/components/auth/login-info-carousel';
import { usePortalAuthStore } from '@/store/portal-auth-store';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = usePortalAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const returnPath = searchParams.get('return') || '/';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Sign in failed');
      }

      const normalized = data.email as string;
      const isAdmin = Boolean(data.is_admin);
      // Session is httpOnly cookie; middleware reads it on every navigation.
      setSession(normalized, null, isAdmin);

      const dest =
        returnPath.startsWith('/') && !returnPath.startsWith('/login')
          ? returnPath
          : '/';
      router.replace(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const renderForm = (idSuffix: string) => (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label
          htmlFor={`email-${idSuffix}`}
          className="block text-[10px] font-bold uppercase tracking-[0.12em] text-primary mb-2"
        >
          Email address
        </label>
        <input
          id={`email-${idSuffix}`}
          type="email"
          autoComplete="email"
          required
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-gray-300 rounded-sm px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      <div className="flex items-center gap-2.5">
        <input
          id={`remember-${idSuffix}`}
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
        <label htmlFor={`remember-${idSuffix}`} className="text-sm text-gray-600">
          Remember me on this device
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary hover:bg-[#c91920] text-white font-bold uppercase tracking-wide text-sm py-3.5 rounded-sm disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Sign in
      </button>
    </form>
  );

  return (
    <>
      {/* Mobile: black floating icons + centered white login card */}
      <div className="lg:hidden relative min-h-screen bg-[#0F0F10] overflow-hidden flex flex-col items-center justify-center px-5 py-10">
        <AnalyticsIconBackdrop />
        <div className="relative z-10 w-full max-w-[22rem]">
          <div className="mb-6 flex justify-center">
            <Image
              src="/logo-dark.png"
              alt="upGrad School of Technology"
              width={140}
              height={48}
              priority
              className="h-auto w-[140px] object-contain"
            />
          </div>
          <div className="bg-white rounded-sm shadow-[0_12px_40px_rgba(0,0,0,0.45)] border border-white/10 p-6 sm:p-7">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary mb-2">
              Secure login
            </p>
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              Sign in to your account
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              Use your authorized email to access reports and analytics.
            </p>
            {renderForm('mobile')}
          </div>
        </div>
      </div>

      {/* Desktop: split carousel + form */}
      <div className="hidden lg:grid min-h-screen grid-cols-2">
        <LoginInfoCarousel />
        <div className="flex items-center justify-center bg-white p-10 min-h-screen">
          <div className="w-[75%] bg-white rounded-sm shadow-sm border border-gray-200 p-12">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary mb-2">
              Secure login
            </p>
            <h2 className="text-3xl font-bold text-gray-900 mb-1">
              Sign in to your account
            </h2>
            <p className="text-sm text-gray-500 mb-8">
              Use your authorized email to access reports and analytics.
            </p>
            {renderForm('desktop')}
          </div>
        </div>
      </div>
    </>
  );
}
