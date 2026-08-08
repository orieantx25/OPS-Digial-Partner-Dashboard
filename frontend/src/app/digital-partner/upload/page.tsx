'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUploadStore } from '@/store/upload-store';

/** Legacy route — opens quick upload modal and returns to dashboard. */
export default function UploadPage() {
  const router = useRouter();
  const openUpload = useUploadStore((s) => s.openUpload);

  useEffect(() => {
    openUpload();
    router.replace('/');
  }, [openUpload, router]);

  return null;
}
