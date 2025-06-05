import { createFileRoute } from "@tanstack/react-router";
import { AudioRecorder } from "../components/audio-recorder";
import { useState } from "react";
import SpeechToTextPage from "@/pages/speech-to-text";
import LiveTranscription from "@/components/live-transcription";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [transcript, setTranscript] = useState("");

  return (
    <div className="">
      {/* {transcript && (
        <p className="text-center mt-4 text-sm italic">{transcript}</p>
      )}

      <AudioRecorder
        onTranscript={(text) => setTranscript((prev) => prev + " " + text)}
        onRecordingComplete={(blob) => {
          console.log("Recording completed:", blob);
        }}
      /> */}
      <LiveTranscription />
    </div>
  );
}
