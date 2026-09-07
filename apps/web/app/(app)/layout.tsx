'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { AppNav } from '../../components/app/AppNav';
import { contentStyle, shellStyle } from '../../components/app/app.styles';

// Wraps every authenticated screen (`app/(app)/*`) in the sidebar shell and
// gates the whole subtree on a session. Each child page still runs its own
// identical redirect guard — this one keeps the shell itself from flashing
// for a signed-out visitor before that guard fires.
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return (
    <div style={shellStyle}>
      <AppNav />
      <div style={contentStyle}>{children}</div>
    </div>
  );
}
