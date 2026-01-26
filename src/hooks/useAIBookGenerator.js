import { useState, useCallback, useRef } from 'react';

/**
 * Hook for managing AI Book Generator state and Server-Sent Events
 */
export const useAIBookGenerator = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState([]);
  const [currentStage, setCurrentStage] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const eventSourceRef = useRef(null);

  const startGeneration = useCallback(async (description, options = {}) => {
    setIsGenerating(true);
    setProgress([]);
    setCurrentStage(null);
    setError(null);
    setResult(null);

    try {
      const token = localStorage.getItem('token');

      if (!token) {
        throw new Error('Authentication required');
      }

      // Create EventSource for Server-Sent Events
      const url = new URL('/api/agent/create-book', window.location.origin);

      // For SSE, we need to use fetch with streaming
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ description, options }),
      });

      if (!response.ok) {
        throw new Error('Failed to start book generation');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // Read the stream
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          setIsGenerating(false);
          break;
        }

        // Decode the chunk
        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE format (data: {json}\n\n)
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));

              setProgress(prev => [...prev, data]);
              setCurrentStage(data.stage);

              if (data.stage === 'done') {
                setResult(data);
                setIsGenerating(false);
              } else if (data.stage === 'error') {
                setError(data.message);
                setIsGenerating(false);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (err) {
      console.error('Book generation error:', err);
      setError(err.message || 'Failed to generate book');
      setIsGenerating(false);
    }
  }, []);

  const reset = useCallback(() => {
    setIsGenerating(false);
    setProgress([]);
    setCurrentStage(null);
    setError(null);
    setResult(null);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  return {
    isGenerating,
    progress,
    currentStage,
    error,
    result,
    startGeneration,
    reset,
  };
};
