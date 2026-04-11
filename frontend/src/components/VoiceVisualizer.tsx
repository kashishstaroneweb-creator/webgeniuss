import { useEffect, useRef } from 'react';

interface VoiceVisualizerProps {
  isListening: boolean;
}

export function VoiceVisualizer({ isListening }: VoiceVisualizerProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!isListening) {
      // Stop everything
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
      analyserRef.current = null;
      audioCtxRef.current = null;
      streamRef.current = null;
      // Reset bars to idle animation
      barsRef.current.forEach((bar) => {
        if (bar) {
          bar.style.height = '4px';
          bar.style.opacity = '0.3';
        }
      });
      return;
    }

    const startVisualizer = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const draw = () => {
          animFrameRef.current = requestAnimationFrame(draw);
          analyser.getByteFrequencyData(dataArray);

          barsRef.current.forEach((bar, i) => {
            if (!bar) return;
            // Map frequency data (0-255) to a height range (4px - 32px)
            const value = dataArray[Math.floor(i * dataArray.length / barsRef.current.length)];
            const height = 4 + (value / 255) * 28;
            bar.style.height = `${height}px`;
            bar.style.opacity = `${0.4 + (value / 255) * 0.6}`;
          });
        };

        draw();
      } catch (err) {
        console.error('VoiceVisualizer: could not access microphone', err);
      }
    };

    startVisualizer();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [isListening]);

  const NUM_BARS = 12;

  return (
    <div className="flex items-center gap-[3px] h-8">
      {Array.from({ length: NUM_BARS }).map((_, i) => (
        <div
          key={i}
          ref={el => { barsRef.current[i] = el; }}
          className="w-[3px] rounded-full transition-none"
          style={{
            height: '4px',
            opacity: 0.3,
            background: isListening
              ? `hsl(${142 + i * 2}, 70%, ${50 + i * 2}%)`
              : 'rgb(34, 197, 94)',
            transition: 'height 0.05s ease, opacity 0.05s ease',
          }}
        />
      ))}
    </div>
  );
}
