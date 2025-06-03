import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RecordPlugin from "wavesurfer.js/dist/plugins/record.esm.js";

interface AudioRecorderProps {
  onRecordingComplete?: (blob: Blob) => void;
  onTranscript?: (text: string) => void;
}

export function AudioRecorder({
  onRecordingComplete,
  onTranscript,
}: AudioRecorderProps) {
  let mediaRecorder: MediaRecorder;

  const socketRef = useRef<WebSocket | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const startLiveRecording = async () => {
    if (!recordRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorderRef.current = recorder;

    socketRef.current = new WebSocket("ws://localhost:9090");

    socketRef.current.onopen = () => {
      recorder.start(500); // start with 500ms timeslice when ws ready
    };

    socketRef.current.onmessage = (event) => {
      try {
        const { transcript } = JSON.parse(event.data);
        if (transcript) onTranscript?.(transcript);
      } catch (err) {
        console.error("Failed to parse message:", event.data);
      }
    };

    recorder.ondataavailable = (event) => {
      if (
        event.data.size > 0 &&
        socketRef.current?.readyState === WebSocket.OPEN
      ) {
        socketRef.current.send(event.data);
      }
    };

    recorder.onerror = (err) => {
      console.error("Recorder error:", err);
    };
  };

  const stopLiveRecording = () => {
    mediaRecorderRef.current?.stop();
    socketRef.current?.close();
    mediaRecorderRef.current = null;
    socketRef.current = null;
  };

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState("00:00");
  const [hasRecording, setHasRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const recordRef = useRef<ReturnType<typeof RecordPlugin.create> | null>(null);
  const micContainerRef = useRef<HTMLDivElement>(null);
  const recordingsContainerRef = useRef<HTMLDivElement>(null);
  const recordedWaveSurferRef = useRef<WaveSurfer | null>(null);

  const createWaveSurfer = () => {
    if (!micContainerRef.current) return;

    // Destroy the previous wavesurfer instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }

    // Create a new Wavesurfer instance
    wavesurferRef.current = WaveSurfer.create({
      container: micContainerRef.current,
      waveColor: "rgb(200, 0, 200)",
      progressColor: "rgb(100, 0, 100)",
    });

    // Initialize the Record plugin
    recordRef.current = wavesurferRef.current.registerPlugin(
      RecordPlugin.create({
        renderRecordedAudio: false,
        scrollingWaveform: true,
      })
    );

    // Render recorded audio
    recordRef.current.on("record-end", (blob) => {
      if (!recordingsContainerRef.current) return;

      const recordedUrl = URL.createObjectURL(blob);
      onRecordingComplete?.(blob);
      setHasRecording(true);
      setRecordedBlob(blob);

      // Create wavesurfer from the recorded audio
      if (recordedWaveSurferRef.current) {
        recordedWaveSurferRef.current.destroy();
      }

      recordedWaveSurferRef.current = WaveSurfer.create({
        container: recordingsContainerRef.current,
        waveColor: "rgb(200, 100, 0)",
        progressColor: "rgb(100, 50, 0)",
        url: recordedUrl,
      });

      // Play button
      const button = document.createElement("button");
      button.textContent = "Play";
      button.onclick = () => recordedWaveSurferRef.current?.playPause();
      recordedWaveSurferRef.current.on(
        "pause",
        () => (button.textContent = "Play")
      );
      recordedWaveSurferRef.current.on(
        "play",
        () => (button.textContent = "Pause")
      );
      recordingsContainerRef.current.appendChild(button);

      // Download link
      const link = document.createElement("a");
      Object.assign(link, {
        href: recordedUrl,
        download:
          "recording." + blob.type.split(";")[0].split("/")[1] || "webm",
        textContent: "Download recording",
      });
      recordingsContainerRef.current.appendChild(link);
    });

    recordRef.current.on("record-progress", (time) => {
      const formattedTime = [
        Math.floor((time % 3600000) / 60000),
        Math.floor((time % 60000) / 1000),
      ]
        .map((v) => (v < 10 ? "0" + v : v))
        .join(":");
      setProgress(formattedTime);
    });
  };

  useEffect(() => {
    createWaveSurfer();

    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }
      if (recordedWaveSurferRef.current) {
        recordedWaveSurferRef.current.destroy();
      }
    };
  }, []);

  // Update your handleRecord to call stopLiveRecording when stopping:
  const handleRecord = async () => {
    if (!recordRef.current) return;

    if (isRecording) {
      recordRef.current.stopRecording();
      stopLiveRecording(); // STOP your manual mediaRecorder and socket here
      setIsRecording(false);
      setIsPaused(false);
      return;
    }

    // clear old stuff...

    await recordRef.current.startRecording();
    await startLiveRecording();

    setIsRecording(true);
  };

  const handlePause = () => {
    if (!recordRef.current) return;

    if (recordRef.current.isPaused()) {
      recordRef.current.resumeRecording();
      setIsPaused(false);
    } else {
      recordRef.current.pauseRecording();
      setIsPaused(true);
    }
  };

  const handleNewRecording = async () => {
    // Clear previous recording
    if (recordingsContainerRef.current) {
      recordingsContainerRef.current.innerHTML = "";
    }
    if (recordedWaveSurferRef.current) {
      recordedWaveSurferRef.current.destroy();
      recordedWaveSurferRef.current = null;
    }
    setRecordedBlob(null);
    setHasRecording(false);
    createWaveSurfer();

    // Start recording immediately
    try {
      if (recordRef.current) {
        await recordRef.current.startRecording();
        setIsRecording(true);
      }
    } catch (error) {
      console.error("Failed to start recording:", error);
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto h-screen flex flex-col items-center justify-center">
      <div className="space-y-4 w-full">
        <div className="flex gap-4 justify-center">
          {!isRecording && !hasRecording && (
            <button
              onClick={handleRecord}
              className="px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors flex items-center gap-2"
            >
              <span className="w-3 h-3 bg-white rounded-full"></span>
              Record
            </button>
          )}

          {isRecording && (
            <>
              <button
                onClick={handlePause}
                className="px-6 py-3 bg-yellow-500 text-white rounded-full hover:bg-yellow-600 transition-colors"
              >
                {isPaused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={handleRecord}
                className="px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
              >
                Stop
              </button>
            </>
          )}

          {hasRecording && !isRecording && (
            <button
              onClick={handleNewRecording}
              className="px-6 py-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
            >
              New Recording
            </button>
          )}
        </div>

        {isRecording && (
          <p className="text-lg font-mono text-center">{progress}</p>
        )}

        <div
          ref={micContainerRef}
          className={`w-full ${!isRecording ? "hidden" : ""}`}
        />

        <div
          ref={recordingsContainerRef}
          className={`mt-4 space-y-4 ${!hasRecording ? "hidden" : ""}`}
        />
      </div>
    </div>
  );
}
