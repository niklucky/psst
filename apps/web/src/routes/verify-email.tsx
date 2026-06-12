import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { trpcClient } from '../trpc';
import { usePageTitle } from '../hooks/usePageTitle';

export function VerifyEmailPage() {
  usePageTitle('Verify email');
  const { token } = useParams({ from: '/verify-email/$token' });
  const [status, setStatus] = useState<'verifying' | 'done' | 'error'>('verifying');

  useEffect(() => {
    let cancelled = false;

    trpcClient.auth.verifyEmail
      .mutate({ token })
      .then(() => {
        if (!cancelled) setStatus('done');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-sm border border-gray-100">
        {status === 'verifying' && (
          <p className="text-sm text-gray-500">Verifying your email…</p>
        )}
        {status === 'done' && (
          <>
            <h1 className="text-xl font-bold text-gray-900">Email verified ✓</h1>
            <p className="text-sm text-gray-500">Your email address has been confirmed.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-xl font-bold text-gray-900">Verification failed</h1>
            <p className="text-sm text-gray-500">
              This link is invalid or has expired. You can request a new one from your profile
              settings.
            </p>
          </>
        )}
        <Link to="/" className="inline-block text-sm text-indigo-600 hover:underline">
          Go to Silo
        </Link>
      </div>
    </div>
  );
}
