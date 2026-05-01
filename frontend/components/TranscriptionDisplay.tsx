"use client";

import { Download } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type TranscriptionSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  confidence_score: number;
};

type TranscriptionDisplayProps = {
  segments: TranscriptionSegment[];
  progress: number;
  isProcessing?: boolean;
  onSegmentChange: (id: string, text: string) => void;
};

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function TranscriptionDisplay({
  segments,
  progress,
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
    <section className="flex min-h-[520px] flex-col border border-slate-700 bg-slate-800/60">
      <div className="flex flex-col gap-3 border-b border-slate-700 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Transcript</h2>
            <span className="text-sm tabular-nums text-slate-300">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} aria-label="Transcription progress" />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handleDownload}
          disabled={!sortedSegments.length}
          title="Download TXT"
        >
          <Download className="h-4 w-4" aria-hidden />
          TXT
        </Button>
      </div>

      <ScrollArea className="h-[440px]">
        <div className="flex flex-col gap-3 p-4">
          {!sortedSegments.length ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">
              {isProcessing ? "Dang nhan dien..." : "Chua co transcript"}
            </div>
          ) : null}

          {sortedSegments.map((segment) => {
            const lowConfidence = segment.confidence_score < 0.8;

            return (
              <article
                key={segment.id}
                className={cn(
                  "grid gap-3 border border-slate-700 bg-slate-900/50 p-3 sm:grid-cols-[140px_1fr]",
                  lowConfidence && "border-amber-500/40 bg-amber-900/30",
                )}
              >
                <div className="text-sm text-slate-300">
                  <div className="font-medium tabular-nums">
                    {formatTime(segment.start)} - {formatTime(segment.end)}
                  </div>
                  <div
                    className={cn(
                      "mt-1 tabular-nums",
                      lowConfidence ? "text-amber-200" : "text-cyan-200",
                    )}
                  ></div>
                </div>

                <Textarea
                  value={segment.text}
                  onChange={(event) =>
                    onSegmentChange(segment.id, event.target.value)
                  }
                  readOnly={true}
                  className="min-h-12 resize-y"
                />
              </article>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}
