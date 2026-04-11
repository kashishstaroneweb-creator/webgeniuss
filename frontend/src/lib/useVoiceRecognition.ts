import { useState, useEffect, useCallback, useRef } from 'react';

// Extend window object to support both standard and webkit variants
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface UseVoiceRecognitionOptions {
  onTranscriptChange?: (transcript: string) => void;
  onEnd?: (finalTranscript: string) => void;
  continuous?: boolean;
}

export function useVoiceRecognition(options: UseVoiceRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Use refs to store the latest versions of callbacks so we don't recreate the `SpeechRecognition` instance on every render
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const transcriptRef = useRef(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true; // Use continuous so we can manually control the 3-second silence timeout
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    const clearSilenceTimeout = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const resetSilenceTimeout = () => {
      clearSilenceTimeout();
      timeoutRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, 3000); // 3 seconds pause threshold
    };

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      resetSilenceTimeout(); // Start the timer as soon as listening starts
    };

    recognition.onresult = (event: any) => {
      resetSilenceTimeout(); // Reset the timer every time the user speaks a new word

      let currentTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        currentTranscript += event.results[i][0].transcript;
      }

      setTranscript(currentTranscript);
      if (optionsRef.current.onTranscriptChange) {
        optionsRef.current.onTranscriptChange(currentTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setError(`Error: ${event.error}`);
      setIsListening(false);
      clearSilenceTimeout();
    };

    recognition.onend = () => {
      setIsListening(false);
      clearSilenceTimeout();
      if (optionsRef.current.onEnd) {
        optionsRef.current.onEnd(transcriptRef.current);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      clearSilenceTimeout();
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []); // Empty dependency array means initialization happens exactly once!

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;

    if (isListening) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      recognitionRef.current.stop();
    } else {
      setTranscript('');
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Could not start speech recognition", e);
      }
    }
  }, [isListening]);

  return {
    isListening,
    transcript,
    error,
    toggleListening,
    isSupported: !!recognitionRef.current,
  };
}
