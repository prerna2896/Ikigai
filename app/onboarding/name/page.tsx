'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OnboardingNamePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/onboarding/context');
  }, [router]);

  return null;
}
