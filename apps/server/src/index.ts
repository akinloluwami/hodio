import { Hono } from "hono";
import { serve } from "@hono/node-server";
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

wss.on("connection", (ws) => {
  console.log("socket: client connected");

  let deepgram = setupDeepgram(ws);

  ws.on("message", (message) => {
    console.log("socket: message received");

    const readyState = deepgram.getReadyState();
    if (readyState === 1) {
      deepgram.send(message);
    } else if (readyState >= 2) {
      console.log("socket: deepgram closed, retrying connection...");
      deepgram.finish();
      deepgram.removeAllListeners();
      deepgram = setupDeepgram(ws);
    } else {
      console.log("socket: deepgram not ready");
    }
  });

  ws.on("close", () => {
    console.log("socket: client disconnected");
    deepgram.finish();
    deepgram.removeAllListeners();
  });
});

server.on("request", app.fetch);
server.listen(9090, () => {
  console.log("🔥 Server listening on http://localhost:9090");
});
