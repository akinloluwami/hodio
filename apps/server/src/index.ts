import { Hono } from "hono";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { WebSocketServer, WebSocket } from "ws";
import * as dotenv from "dotenv";
import { createServer } from "http";

dotenv.config();

const app = new Hono();
const server = createServer();
const wss = new WebSocketServer({ server });

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY!);
let keepAlive: NodeJS.Timer;

const setupDeepgram = (ws: WebSocket) => {
  const deepgram = deepgramClient.listen.live({
    language: "en",
    punctuate: true,
    smart_format: true,
    model: "nova",
  });

  if (keepAlive) clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    console.log("deepgram: keepalive");
    deepgram.keepAlive();
  }, 10_000);

  deepgram.addListener(LiveTranscriptionEvents.Open, () => {
    console.log("deepgram: connected");
    if (ws["deepgramAudioBuffer"]) {
      console.log(
        `deepgram: flushing ${ws["deepgramAudioBuffer"].length} buffered messages.`
      );
      ws["deepgramAudioBuffer"].forEach((bufferedMessage: Buffer) => {
        deepgram.send(bufferedMessage);
      });
      ws["deepgramAudioBuffer"] = [];
    }

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
      console.log("deepgram: transcript received");
      ws.send(JSON.stringify(data));
    });

    deepgram.addListener(LiveTranscriptionEvents.Close, () => {
      console.log("deepgram: disconnected");
      clearInterval(keepAlive);
      deepgram.finish();
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, (error) => {
      console.error("deepgram: error received", error);
      ws.send(JSON.stringify({ error: "Deepgram transcription error." }));
    });

    deepgram.addListener(LiveTranscriptionEvents.Warning, (warning) => {
      console.warn("deepgram: warning received", warning);
    });

    deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
      console.log("deepgram: metadata received");
      ws.send(JSON.stringify({ metadata: data }));
    });
  });

  return deepgram;
};

wss.on("connection", (ws: WebSocket) => {
  console.log("socket: client connected");

  (ws as any).deepgramAudioBuffer = [];

  let deepgram = setupDeepgram(ws);

  ws.on("message", (message: Buffer) => {
    const readyState = deepgram.getReadyState();
    console.log("Deepgram ReadyState:", readyState);

    if (readyState === 1) {
      deepgram.send(message);
    } else {
      if (readyState === 0) {
        (ws as any).deepgramAudioBuffer.push(message);
        console.log("socket: deepgram not ready, message buffered.");
      } else {
        console.log("socket: deepgram closed, retrying connection...");
        deepgram.finish();
        deepgram.removeAllListeners();
        deepgram = setupDeepgram(ws);
        (ws as any).deepgramAudioBuffer.push(message);
        console.log("socket: message buffered during deepgram reconnect.");
      }
    }
  });

  ws.on("close", () => {
    console.log("socket: client disconnected");
    deepgram.finish();
    deepgram.removeAllListeners();
    if ((ws as any).deepgramAudioBuffer) {
      (ws as any).deepgramAudioBuffer = [];
    }
    clearInterval(keepAlive);
  });
});

server.on("request", app.fetch);
server.listen(9090, () => {
  console.log("🔥 Server listening on http://localhost:9090");
});
