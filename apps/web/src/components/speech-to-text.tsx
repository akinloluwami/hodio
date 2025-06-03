import { useEffect, useRef, useState } from "react";
import RecordRTC, { StereoAudioRecorder } from "recordrtc";

const GLADIA_WS_URL = "https://api.gladia.io/v2/live";
const SAMPLE_RATE = 16000;

export const SpeechToText = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecordRTC | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const apiKey = "d4b4f719-08e4-485b-9be8-35f340f1f6ea";

  const initWebSocket = async (): Promise<WebSocket> => {
    // First, initiate the session
    const response = await fetch(GLADIA_WS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GLADIA-KEY": apiKey,
      },
      body: JSON.stringify({
        sample_rate: SAMPLE_RATE,
      }),
    });

    if (!response.ok) {
      const message = `${response.status}: ${(await response.text()) || response.statusText}`;
      throw new Error(message);
    }

    const { url } = await response.json();
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      console.log("WebSocket connected");
      setStatus("Connected and ready to record");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      console.log("WebSocket message received:", message);

      if (message?.type === "transcript") {
        if (message.data.is_final) {
          setTranscript((prev) => {
            const updated = prev
              ? `${prev} ${message.data.utterance.text}`
              : message.data.utterance.text;
            return updated;
          });
          setStatus("Transcribing...");
        } else {
          // Handle partial transcript if needed
          console.log("Partial transcript:", message.data.utterance.text);
        }
      }
    });

    socket.addEventListener("error", (error) => {
      console.error("WebSocket error:", error);
      setError("WebSocket connection error");
      setStatus("Connection error");
    });

    socket.addEventListener("close", ({ code, reason }) => {
      if (code === 1000) {
        console.log("WebSocket closed normally");
        setStatus("Session ended");
      } else {
        console.error(
          `WebSocket closed with code ${code} and reason ${reason}`
        );
        setError(`Connection closed: ${reason}`);
        setStatus("Connection closed");
      }
    });

    return socket;
  };

  const startRecording = async () => {
    try {
      setError(null);
      setStatus("Initializing...");

      const socket = await initWebSocket();

      // Wait for connection to be established
      await new Promise<void>((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          socket.addEventListener("open", () => resolve());
          socket.addEventListener("error", (error) => reject(error));
        }
      });

      // Get audio stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
        },
      });
      streamRef.current = stream;

      // Initialize recorder
      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/wav",
        recorderType: StereoAudioRecorder,
        timeSlice: 1000,
        desiredSampRate: SAMPLE_RATE,
        numberOfAudioChannels: 1,
        ondataavailable: async (blob: Blob) => {
          if (socket.readyState === WebSocket.OPEN) {
            const buffer = await blob.arrayBuffer();
            // Remove WAV header (44 bytes)
            const modifiedBuffer = buffer.slice(44);
            console.log(
              "Sending audio chunk, size:",
              modifiedBuffer.byteLength
            );
            socket.send(modifiedBuffer);
          }
        },
      });

      recorderRef.current = recorder;
      recorder.startRecording();
      setIsRecording(true);
      setStatus("Recording started");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start recording"
      );
      setStatus("Failed to start recording");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.stopRecording(() => {
        recorderRef.current?.destroy();
        recorderRef.current = null;
      });
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.close();
    }

    setIsRecording(false);
    setStatus("Processing final results...");
  };

  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
  }, []);

  return (
    <div className="p-4">
      <div className="flex gap-4 mb-4">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`px-4 py-2 rounded ${
            isRecording
              ? "bg-red-500 hover:bg-red-600"
              : "bg-blue-500 hover:bg-blue-600"
          } text-white`}
        >
          {isRecording ? "Stop Recording" : "Start Recording"}
        </button>
        {status && (
          <div className="px-4 py-2 text-gray-600">Status: {status}</div>
        )}
      </div>

      {error && <div className="text-red-500 mb-4">Error: {error}</div>}

      <div className="mt-4">
        <h3 className="text-lg font-semibold mb-2">Transcript:</h3>
        <div className="p-4 bg-gray-100 rounded min-h-[100px]">
          {transcript || "No transcript yet..."}
        </div>
      </div>
    </div>
  );
};
