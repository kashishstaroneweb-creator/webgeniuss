import { useState, useEffect, useRef } from 'react';

interface UseTypewriterOptions {
  speed?: number; // ms per character
}

export function useTypewriter(text: string, options: UseTypewriterOptions = {}) {
  const { speed = 35 } = options;
  const [displayed, setDisplayed] = useState('');
  const [isDone, setIsDone] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Reset whenever text changes
    setDisplayed('');
    setIsDone(false);
    indexRef.current = 0;

    if (!text) {
      setIsDone(true);
      return;
    }

    const tick = () => {
      indexRef.current += 1;
      setDisplayed(text.slice(0, indexRef.current));

      if (indexRef.current < text.length) {
        timerRef.current = setTimeout(tick, speed);
      } else {
        setIsDone(true);
      }
    };

    timerRef.current = setTimeout(tick, speed);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, speed]);

  return { displayed, isDone };
}
