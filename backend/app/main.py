from __future__ import annotations

import asyncio
import json
import math
import os
import tempfile
import uuid
import librosa
import soundfile as sf
import torch
from hanziconv import HanziConv
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel
from silero_vad import get_speech_timestamps, load_silero_vad, read_audio


ALLOWED_SUFFIXES = {".mp3", ".wav"}
JOBS: dict[str, dict[str, Any]] = {}


def confidence_from_segment(segment: Any) -> float:
    """Estimate a compact 0..1 confidence score from faster-whisper metadata."""
    avg_logprob = getattr(segment, "avg_logprob", None)
    no_speech_prob = getattr(segment, "no_speech_prob", 0.0) or 0.0

    if avg_logprob is None:
        return round(max(0.0, min(1.0, 1.0 - no_speech_prob)), 3)

    token_confidence = math.exp(min(0.0, float(avg_logprob)))
    confidence = token_confidence * (1.0 - float(no_speech_prob))
    return round(max(0.0, min(1.0, confidence)), 3)


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@asynccontextmanager
async def lifespan(app: FastAPI):
    cpu_threads = max(1, (os.cpu_count() or 4) - 1)
    app.state.whisper = WhisperModel(
        "large-v3",
        device="cpu",
        compute_type="int8",
        cpu_threads=cpu_threads,
        num_workers=1,
    )
    app.state.vad = load_silero_vad()
    yield


app = FastAPI(title="AudioWeb STT API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict[str, str]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Only .mp3 and .wav files are supported.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        while chunk := await file.read(1024 * 1024):
            tmp.write(chunk)
        audio_path = Path(tmp.name)

    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        "queue": asyncio.Queue(),
        "status": "queued",
        "segments": [],
    }

    asyncio.create_task(run_transcription_job(job_id, audio_path))
    return {"job_id": job_id, "events_url": f"/transcribe/{job_id}/events"}


@app.get("/transcribe/{job_id}/events")
async def transcription_events(job_id: str) -> StreamingResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    queue: asyncio.Queue[dict[str, Any]] = job["queue"]

    async def event_stream():
        yield sse("ready", {"job_id": job_id})
        while True:
            message = await queue.get()
            yield sse(message["event"], message["data"])
            if message["event"] in {"done", "transcription_error"}:
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
async def run_transcription_job(job_id: str, audio_path: Path) -> None:
    job = JOBS[job_id]
    queue = job["queue"]

    def emit(event: str, data: dict[str, Any]):
        queue.put_nowait({"event": event, "data": data})

    try:
        # 1. Đọc và chuẩn hóa (giữ nguyên)
        wav, sr = sf.read(str(audio_path))
        if len(wav.shape) > 1: wav = wav.mean(axis=1)
        if sr != 16000: wav = librosa.resample(wav, orig_sr=sr, target_sr=16000)

        # 2. VAD: Lấy các đoạn có tiếng
        wav_tensor = torch.from_numpy(wav).float()
        speech_timestamps = get_speech_timestamps(wav_tensor, app.state.vad, sampling_rate=16000)

        # 3. Chạy Whisper trên cả file nhưng truyền kèm prompt VAD
        # Cách này cho phép Whisper tự căn chỉnh dựa trên VAD mà vẫn giữ ngữ cảnh câu
        segments, info = app.state.whisper.transcribe(
            str(audio_path),
            beam_size=5,
            # vad_filter=True,    # Tự động dùng VAD của Whisper
            language="zh",
            temperature=0.0,
            initial_prompt="这是一首中文歌曲，请转录歌词。"
        )

        last_text = ""
        for index, segment in enumerate(segments):
            # Lọc trùng lặp và chuyển Giản thể
            text = HanziConv.toSimplified(segment.text.strip())
            
            # Chỉ gửi nếu nội dung khác câu trước và có ý nghĩa
            if text and text != last_text and len(text) > 1:
                last_text = text
                emit("segment", {
                    "id": index,
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": text,
                    "confidence": confidence_from_segment(segment)
                })

        emit("done", {"status": "success"})
    except Exception as e:
        emit("transcription_error", {"message": f"Lỗi xử lý: {str(e)}"})
    finally:
        if audio_path.exists(): os.remove(audio_path)
    job = JOBS[job_id]
    queue = job["queue"]

    def emit(event: str, data: dict[str, Any]):
        queue.put_nowait({"event": event, "data": data})

    try:
        wav, sr = sf.read(str(audio_path))
        if len(wav.shape) > 1: wav = wav.mean(axis=1)
        if sr != 16000: wav = librosa.resample(wav, orig_sr=sr, target_sr=16000)
        wav_tensor = torch.from_numpy(wav).float()

        # 1. Lấy timestamp từ Silero VAD
        speech_timestamps = get_speech_timestamps(wav_tensor, app.state.vad, sampling_rate=16000)

        # 2. Xử lý từng đoạn (Chunking) thay vì chạy cả file
        last_text = ""
        for i, ts in enumerate(speech_timestamps):
            # Cắt đoạn audio từ tensor
            start_sample = int(ts['start'])
            end_sample = int(ts['end'])
            chunk = wav_tensor[start_sample:end_sample]
            
            # Lưu tạm chunk này để Whisper xử lý
            chunk_path = f"tmp_{job_id}_{i}.wav"
            sf.write(chunk_path, chunk.numpy(), 16000)
            
            # Whisper xử lý từng đoạn nhỏ
            segments, _ = app.state.whisper.transcribe(
                chunk_path, beam_size=5, language="zh"
            )
            
            for segment in segments:
                text = HanziConv.toSimplified(segment.text.strip())
                if text and text != last_text:
                    last_text = text
                    emit("segment", {
                        "id": f"{i}",
                        "start": round(ts['start'] / 16000, 2),
                        "end": round(ts['end'] / 16000, 2),
                        "text": text,
                        "confidence": confidence_from_segment(segment)
                    })
            
            # Xóa chunk tạm
            if os.path.exists(chunk_path): os.remove(chunk_path)

        emit("done", {"status": "success"})
    except Exception as e:
        emit("transcription_error", {"message": str(e)})
    finally:
        if audio_path.exists(): os.remove(audio_path)
    job = JOBS[job_id]
    queue = job["queue"]

    def emit(event: str, data: dict[str, Any]):
        queue.put_nowait({"event": event, "data": data})

    try:
        # 1. Đọc file
        wav, sr = sf.read(str(audio_path))
        if len(wav.shape) > 1:
            wav = wav.mean(axis=1)
        if sr != 16000:
            wav = librosa.resample(wav, orig_sr=sr, target_sr=16000)
        wav_tensor = torch.from_numpy(wav).float()

        # 2. VAD
        speech_windows = get_speech_timestamps(wav_tensor, app.state.vad, sampling_rate=16000)

        # 3. Whisper (đã tối ưu Level 1)
        segments, info = app.state.whisper.transcribe(
            str(audio_path), 
            beam_size=10, 
            best_of=5,
            vad_filter=True,
            language="zh",
            no_speech_threshold=0.6, 
            condition_on_previous_text=True,
            temperature=0.0
        )

        # 4. Hậu xử lý & Chống lặp
        last_text = ""
        for index, segment in enumerate(segments):
            # Chuyển giản thể và chuẩn hóa
            current_text = HanziConv.toSimplified(segment.text.strip())
            
            # Kiểm tra lặp: Nếu trùng câu trước hoặc trống, bỏ qua
            if current_text == last_text or not current_text:
                continue
            
            last_text = current_text
            
            payload = {
                "id": index,
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": current_text, 
                "confidence": confidence_from_segment(segment)
            }
            emit("segment", payload)

        emit("done", {"status": "success"})
    except Exception as e:
        emit("transcription_error", {"message": f"Lỗi xử lý file: {str(e)}"})
    finally:
        if audio_path.exists(): os.remove(audio_path)