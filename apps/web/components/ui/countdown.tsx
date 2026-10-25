'use client';
import { useEffect, useState } from 'react';
import { humanDuration } from '@/lib/utils';

/** Live countdown to a unix-seconds deadline. Says "passed" afterwards. */
export function Countdown({ until, prefix, passedText = 'passed' }: { until: number; prefix?: string; passedText?: string }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const left = until - now;
  if (left <= 0) return <span className="tabular font-mono text-danger">{passedText}</span>;
  const text = left < 3600 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : humanDuration(left);
  return (
    <span className="tabular font-mono" aria-live="off">
      {prefix ? `${prefix} ` : ''}
      {text}
    </span>
  );
}
