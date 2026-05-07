'use client';
import { useState, useEffect } from 'react';
import { isValidTimecode } from '@stemfer/shared/utils/timecode';

interface Props {
  value:    string;
  onChange: (tc: string) => void;
  disabled?: boolean;
}

export function TimecodeInput({ value, onChange, disabled }: Props) {
  const [local, setLocal] = useState(value);
  const [error, setError] = useState(false);

  useEffect(() => { setLocal(value); }, [value]);

  const handleBlur = () => {
    if (isValidTimecode(local)) {
      setError(false);
      onChange(local);
    } else {
      setError(true);
      setLocal(value); // reset
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') { setLocal(value); setError(false); }
  };

  return (
    <input
      value={local}
      onChange={e => { setLocal(e.target.value); setError(false); }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className={`timecode w-32 bg-transparent border-b ${error ? 'border-red-500' : 'border-zinc-700 focus:border-brand-green-500'} outline-none px-1 py-0.5 text-xs text-brand-green-400`}
      placeholder="HH:MM:SS:MS"
      spellCheck={false}
    />
  );
}
