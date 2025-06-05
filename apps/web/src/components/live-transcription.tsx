import React, { useEffect, useRef, useState, useCallback } from "react";
import { BsRecordCircleFill } from "react-icons/bs";
import { IoStop } from "react-icons/io5";
import WaveSurfer from "wavesurfer.js";
import RecordPlugin from "wavesurfer.js/dist/plugins/record.esm.js";

interface TranscriptData {
  channel: {
    alternatives: Array<{
      transcript: string;
      words?: Array<{
        word: string;
        start: number;
        end: number;
        confidence: number;
        punctuated_word: string;
      }>;
    }>;
  };
  is_final: boolean;
}

interface MetadataData {
  metadata: any;
}

type WebSocketMessage = TranscriptData | MetadataData;

const LiveTranscription: React.FC = () => {
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [wordTimings, setWordTimings] = useState<
    Array<{
      word: string;
      start: number;
      end: number;
      punctuated_word: string;
    }>
  >([]);
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<string>("00:00");
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const waveformContainerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const recordPluginRef = useRef<RecordPlugin | null>(null);

  const playbackWaveformContainerRef = useRef<HTMLDivElement | null>(null);
  const playbackWavesurferRef = useRef<WaveSurfer | null>(null);

  const formatTime = (milliseconds: number): string => {
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return [minutes, seconds].map((v) => (v < 10 ? "0" + v : v)).join(":");
  };

  const startListening = useCallback(async () => {
    setError(null);
    try {
      websocketRef.current = new WebSocket("ws://localhost:9090");

      websocketRef.current.onopen = () => {
        console.log("WebSocket connection opened");
        setIsListening(true);
        setIsRecordingPaused(false);
        setTranscripts([]);
        setRecordingTime("00:00");
        setRecordedAudioBlob(null);
        startMicrophone();
      };

      websocketRef.current.onmessage = (event) => {
        const data: WebSocketMessage = JSON.parse(event.data);
        if ("channel" in data && data.channel?.alternatives) {
          const transcript = data.channel.alternatives[0]?.transcript;
          const words = data.channel.alternatives[0]?.words;

          if (transcript) {
            setTranscripts((prev) => {
              if (data.is_final) {
                return [...prev, transcript];
              } else {
                const newTranscripts = [...prev];
                if (newTranscripts.length === 0) {
                  newTranscripts.push(transcript);
                } else {
                  newTranscripts[newTranscripts.length - 1] = transcript;
                }
                return newTranscripts;
              }
            });

            if (words) {
              setWordTimings((prev) => {
                if (data.is_final) {
                  return [...prev, ...words];
                } else {
                  const newTimings = [...prev];
                  if (newTimings.length === 0) {
                    newTimings.push(...words);
                  } else {
                    // Replace the last set of words
                    const lastWordIndex = newTimings.length - words.length;
                    newTimings.splice(lastWordIndex, words.length, ...words);
                  }
                  return newTimings;
                }
              });
            }
          }
        } else if ("metadata" in data) {
          console.log("Received metadata:", data.metadata);
        }
      };

      websocketRef.current.onclose = (event) => {
        console.log("WebSocket connection closed", event.code, event.reason);
        setIsListening(false);
        stopMicrophone();
      };

      websocketRef.current.onerror = (event) => {
        console.error("WebSocket error:", event);
        setError(
          "WebSocket error. Please check server and network connection."
        );
        setIsListening(false);
        stopMicrophone();
      };
    } catch (err) {
      console.error("Failed to connect to WebSocket:", err);
      setError("Failed to connect to transcription service. Please try again.");
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (
      websocketRef.current &&
      websocketRef.current.readyState === WebSocket.OPEN
    ) {
      websocketRef.current.close();
    }
    stopMicrophone();
    setIsListening(false);
    setIsRecordingPaused(false);
  }, []);

  const startMicrophone = useCallback(async () => {
    try {
      if (!wavesurferRef.current && waveformContainerRef.current) {
        wavesurferRef.current = WaveSurfer.create({
          container: waveformContainerRef.current,
          waveColor: "rgb(0, 123, 255)",
          progressColor: "rgb(0, 80, 200)",
          barWidth: 2,
          height: 100,
          minPxPerSec: 1,
          cursorColor: "transparent",
          interact: false,
        });

        recordPluginRef.current = wavesurferRef.current.registerPlugin(
          RecordPlugin.create({
            renderRecordedAudio: false,
            scrollingWaveform: true,
            continuousWaveform: false,
          })
        );

        recordPluginRef.current.on("record-progress", (time) => {
          setRecordingTime(formatTime(time));
        });

        recordPluginRef.current.on("record-end", (blob) => {
          console.log("Recording ended via RecordPlugin", blob);
          setRecordedAudioBlob(blob);

          if (wavesurferRef.current) {
            wavesurferRef.current.empty();
          }
        });
      }

      await recordPluginRef.current?.startRecording();
      console.log("RecordPlugin started recording");
      setIsRecordingPaused(false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (
          event.data.size > 0 &&
          websocketRef.current &&
          websocketRef.current.readyState === WebSocket.OPEN
        ) {
          websocketRef.current.send(event.data);
        }
      };

      mediaRecorderRef.current.start(250);
      console.log("MediaRecorder started for WebSocket");
    } catch (err) {
      console.error(
        "Error accessing microphone or starting RecordPlugin:",
        err
      );
      setError(
        "Failed to access microphone or start visualization. Please ensure microphone permissions are granted."
      );
      setIsListening(false);

      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
      recordPluginRef.current = null;
    }
  }, []);

  const stopMicrophone = useCallback(() => {
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
      console.log("MediaRecorder stopped");
    }

    if (
      recordPluginRef.current?.isRecording() ||
      recordPluginRef.current?.isPaused()
    ) {
      recordPluginRef.current.stopRecording();
      console.log("RecordPlugin stopped recording");
    }
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }
    recordPluginRef.current = null;
    setRecordingTime("00:00");
    setIsRecordingPaused(false);
  }, []);

  const handlePauseResumeRecording = useCallback(() => {
    if (recordPluginRef.current) {
      if (recordPluginRef.current.isPaused()) {
        recordPluginRef.current.resumeRecording();
        setIsRecordingPaused(false);
        console.log("Recording resumed");
      } else if (recordPluginRef.current.isRecording()) {
        recordPluginRef.current.pauseRecording();
        setIsRecordingPaused(true);
        console.log("Recording paused");
      }
    }

    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.pause();
      } else if (mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.resume();
      }
    }
  }, []);

  const handleStopAndPlayBack = useCallback(() => {
    if (isListening) {
      stopListening();
    }

    if (recordedAudioBlob) {
      if (playbackWavesurferRef.current) {
        playbackWavesurferRef.current.destroy();
      }

      if (playbackWaveformContainerRef.current) {
        playbackWavesurferRef.current = WaveSurfer.create({
          container: playbackWaveformContainerRef.current,
          waveColor: "rgb(255, 123, 0)",
          progressColor: "rgb(200, 80, 0)",
          barWidth: 2,
          height: 100,
          cursorColor: "transparent",
          interact: true,
        });

        const audioUrl = URL.createObjectURL(recordedAudioBlob);
        playbackWavesurferRef.current.load(audioUrl);

        playbackWavesurferRef.current.on("ready", () => {
          playbackWavesurferRef.current?.play();
        });

        playbackWavesurferRef.current.on("audioprocess", (currentTime) => {
          // Find the current word based on the audio time
          const currentWord = wordTimings.findIndex(
            (word) => currentTime >= word.start && currentTime <= word.end
          );
          setCurrentWordIndex(currentWord);
        });

        playbackWavesurferRef.current.on("finish", () => {
          console.log("Playback finished");
          playbackWavesurferRef.current?.stop();
          setCurrentWordIndex(-1);
        });
      }
    } else {
      console.log("No recorded audio to play back.");
    }
  }, [isListening, recordedAudioBlob, stopListening, wordTimings]);

  useEffect(() => {
    return () => {
      stopListening();

      if (playbackWavesurferRef.current) {
        playbackWavesurferRef.current.destroy();
        playbackWavesurferRef.current = null;
      }
    };
  }, [stopListening]);

  return (
    <div className="flex items-center justify-center min-h-screen flex-col p-4">
      {/* {error && <p className="text-red-600 mb-4">Error: {error}</p>} */}

      <div className="w-full">
        <div
          ref={waveformContainerRef}
          style={{
            height: "100px",
            overflow: "hidden",
          }}
        ></div>

        {recordedAudioBlob && (
          <div
            ref={playbackWaveformContainerRef}
            style={{
              height: "100px",
              overflow: "hidden",
            }}
          ></div>
        )}
      </div>

      <div className="mt-6">
        {transcripts.length === 0 && !isListening && !recordedAudioBlob
          ? ""
          : transcripts.map((transcript, index) => (
              <p key={index} className="my-1">
                {transcript.split(" ").map((word, wordIndex) => {
                  const globalWordIndex =
                    index * transcript.split(" ").length + wordIndex;
                  const isCurrentWord = globalWordIndex === currentWordIndex;
                  return (
                    <span
                      key={wordIndex}
                      className={`inline-block px-1 mx-0.5 rounded ${
                        isCurrentWord ? "bg-yellow-200" : ""
                      }`}
                    >
                      {word}
                    </span>
                  );
                })}
              </p>
            ))}
      </div>

      <div className="flex items-center gap-x-2">
        <button
          onClick={isListening ? stopListening : startListening}
          className={`px-4 py-2 text-white text-lg font-semibold rounded-full bg-red-500 flex items-center gap-2 hover:bg-red-600 transition-colors ${
            isListening ? "bg-red-600" : "bg-red-500"
          }`}
        >
          {isListening ? <IoStop /> : <BsRecordCircleFill />}
          {isListening ? "Stop" : "Record"}
        </button>
        {isListening && (
          <button
            onClick={() => {
              console.log("Pause/Resume Recording clicked");
              handlePauseResumeRecording;
            }}
            className={`px-4 py-2 text-white text-lg font-semibold rounded-full ${
              isRecordingPaused ? "bg-blue-600" : "bg-yellow-500"
            }`}
          >
            {isRecordingPaused ? "Resume" : "Pause"}
          </button>
        )}
        {recordedAudioBlob && !isListening && (
          <button
            onClick={handleStopAndPlayBack}
            className="px-4 py-2 text-white text-lg font-semibold rounded-full bg-purple-600"
          >
            Play
          </button>
        )}
      </div>
    </div>
  );
};

export default LiveTranscription;
