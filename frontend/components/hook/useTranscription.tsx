import { useState, useEffect } from 'react';

// Định nghĩa kiểu dữ liệu cho Segment dựa trên Backend trả về
export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export const useTranscription = (jobId: string | null) => {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState(0); // Thời gian còn lại (giây)
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (!jobId) return;

    setStatus('processing');
    setSegments([]); // Reset khi có job mới
    setProgress(0);

    // Mở kết nối SSE tới Backend
    const eventSource = new EventSource(`http://localhost:8000/transcribe/${jobId}/events`);

    // Lắng nghe sự kiện 'segment'
    eventSource.addEventListener('segment', (e) => {
      const data = JSON.parse(e.data);
      
      // Cập nhật mảng transcript
      setSegments((prev) => [...prev, data]);
      
      // Cập nhật thanh tiến trình và ETA
      setProgress(data.progress);
      setEta(data.eta);
    });

    // Lắng nghe sự kiện 'done'
    eventSource.addEventListener('done', () => {
      setStatus('done');
      setProgress(100);
      setEta(0);
      eventSource.close();
    });

    // Xử lý lỗi
    eventSource.addEventListener('transcription_error', (e) => {
      console.error("Lỗi dịch:", e);
      setStatus('error');
      eventSource.close();
    });

    // Cleanup khi component unmount
    return () => {
      eventSource.close();
    };
  }, [jobId]);

  return { segments, progress, eta, status };
};