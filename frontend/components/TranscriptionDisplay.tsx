"use client";

import { Download } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type TranscriptionSegment = {
  id: string | number;
  start: number;
  end: number;
  text: string;
  confidence: number;
};

type TranscriptionDisplayProps = {
  segments: TranscriptionSegment[];
  progress: number;
  isProcessing?: boolean;
  stats: { elapsed: number; eta: number };
  onSegmentChange: (id: string | number, text: string) => void;
};

function formatDuration(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function TranscriptionDisplay({
  segments,
  progress,
  stats,
  isProcessing = false,
  onSegmentChange,
}: TranscriptionDisplayProps) {
  const sortedSegments = useMemo(
    () => [...segments].sort((a, b) => a.start - b.start),
    [segments],
  );

  function handleDownload() {
    const content = sortedSegments
      .map((segment) => {
        const range = `[${formatTime(segment.start)} - ${formatTime(segment.end)}]`;
        return `${range} ${segment.text.trim()}`;
      })
      .join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `transcription-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex min-h-[520px] flex-col border border-slate-700 bg-slate-800/60 rounded-md">
      <div className="flex flex-col gap-3 border-b border-slate-700 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-slate-100">Transcript</h2>
            <div className="flex items-center space-x-4">
              {isProcessing && stats.eta > 0 && (
                <span className="text-sm text-slate-400">
                  ETA:{" "}
                  <span className="text-cyan-400 font-mono">
                    {formatDuration(stats.eta)}
                  </span>
                </span>
              )}
              <span className="text-sm font-mono text-slate-300">
                {Math.round(progress)}%
              </span>
            </div>
          </div>
          <Progress
            value={progress}
            aria-label="Transcription progress"
            className="h-2"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handleDownload}
          disabled={!sortedSegments.length}
          title="Download TXT"
          className="ml-4"
        >
          <Download className="mr-2 h-4 w-4" aria-hidden />
          TXT
        </Button>
      </div>

      <ScrollArea className="h-[440px]">
        <div className="flex flex-col gap-3 p-4">
          {!sortedSegments.length ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">
              {isProcessing
                ? "Đang nhận diện âm thanh..."
                : "Chưa có transcript"}
            </div>
          ) : null}

          {sortedSegments.map((segment) => {
            const lowConfidence = segment.confidence < 0.8;

            return (
              <article
                key={segment.id}
                className={cn(
                  "grid gap-3 border border-slate-700 bg-slate-900/50 p-3 sm:grid-cols-[140px_1fr] rounded transition-colors",
                  lowConfidence && "border-amber-500/40 bg-amber-900/30",
                )}
              >
                <div className="text-sm text-slate-300 pt-2">
                  <div className="font-mono tabular-nums">
                    {formatTime(segment.start)} - {formatTime(segment.end)}
                  </div>
                  {/* Có thể hiển thị thêm % độ tự tin nếu bạn muốn, tôi ẩn đi cho giao diện sạch */}
                  {/* <div className={cn("mt-1 text-xs", lowConfidence ? "text-amber-400" : "text-cyan-400")}>
                    {Math.round(segment.confidence * 100)}% Match
                  </div> */}
                </div>

                <Textarea
                  value={segment.text}
                  onChange={(event) =>
                    onSegmentChange(segment.id, event.target.value)
                  }
                  readOnly={true}
                  className="min-h-12 resize-y bg-slate-800/50 border-slate-700 text-slate-200 focus-visible:ring-cyan-500/50"
                  placeholder="Đang dịch..."
                />
              </article>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}
