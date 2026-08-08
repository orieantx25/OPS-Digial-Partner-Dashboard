import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <p className="text-xs text-gray-500">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
