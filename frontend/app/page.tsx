"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadCloud } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import {
  TranscriptionDisplay,
  type TranscriptionSegment,
} from "@/components/TranscriptionDisplay";
import { cn } from "@/lib/utils";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const SEGMENTS_QUERY_KEY = ["transcription-segments"] as const;

type TranscribeJob = {
  job_id: string;
  events_url: string;
};

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "processing" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const { data: segments = [] } = useQuery({
    queryKey: SEGMENTS_QUERY_KEY,
    queryFn: async () => [] as TranscriptionSegment[],
    initialData: [],
    staleTime: Infinity,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE_URL}/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return (await response.json()) as TranscribeJob;
    },
    onMutate: () => {
      eventSourceRef.current?.close();
      queryClient.setQueryData<TranscriptionSegment[]>(SEGMENTS_QUERY_KEY, []);
      setProgress(0);
      setStatus("uploading");
      setError(null);
    },
    onSuccess: (job) => {
      setStatus("processing");
      const eventsUrl = job.events_url.startsWith("http")
        ? job.events_url
        : `${API_BASE_URL}${job.events_url}`;
      const source = new EventSource(eventsUrl);
      eventSourceRef.current = source;

      source.addEventListener("segment", (event) => {
        const segment = JSON.parse(
          (event as MessageEvent).data,
        ) as TranscriptionSegment;
        queryClient.setQueryData<TranscriptionSegment[]>(
          SEGMENTS_QUERY_KEY,
          (current = []) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            byId.set(segment.id, segment);
            return Array.from(byId.values()).sort((a, b) => a.start - b.start);
          },
        );
      });

      source.addEventListener("progress", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          value: number;
        };
        setProgress(payload.value);
      });

      source.addEventListener("done", () => {
        setProgress(100);
        setStatus("done");
        source.close();
      });

      source.addEventListener("transcription_error", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          message: string;
        };
        setError(payload.message);
        setStatus("error");
        source.close();
      });

      source.onerror = () => {
        setError("Mat ket noi toi SSE stream.");
        setStatus("error");
        source.close();
      };
    },
    onError: (cause) => {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    },
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
        uploadMutation.mutate(file);
      }
    },
    [uploadMutation],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "audio/mpeg": [".mp3"],
      "audio/wav": [".wav"],
      "audio/x-wav": [".wav"],
    },
    maxFiles: 1,
    noClick: true,
    noKeyboard: true,
  });

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  function handleSegmentChange(id: string, text: string) {
    queryClient.setQueryData<TranscriptionSegment[]>(
      SEGMENTS_QUERY_KEY,
      (current = []) =>
        current.map((segment) =>
          segment.id === id ? { ...segment, text } : segment,
        ),
    );
  }

  return (
    <main className="min-h-screen bg-slate-900 px-5 py-6 text-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-sm text-slate-400">{status.toUpperCase()}</div>
        </header>

        <section
          {...getRootProps()}
          className={cn(
            "flex min-h-44 flex-col items-center justify-center gap-4 border border-dashed border-slate-600 bg-slate-800/50 p-6 text-center",
            isDragActive && "border-cyan-300 bg-cyan-950/30",
          )}
        >
          <input {...getInputProps()} />
          <UploadCloud className="h-10 w-10 text-cyan-300" aria-hidden />
          <div>
            <h2 className="text-xl font-medium">Drag audio</h2>
          </div>
          <Button
            type="button"
            onClick={open}
            disabled={uploadMutation.isPending}
          >
            Browse
          </Button>
        </section>

        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        <TranscriptionDisplay
          segments={segments}
          progress={progress}
          isProcessing={status === "uploading" || status === "processing"}
          onSegmentChange={handleSegmentChange}
        />
      </div>
    </main>
  );
}
