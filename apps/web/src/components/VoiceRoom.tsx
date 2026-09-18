"use client";

import { Room, RoomEvent, createLocalAudioTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type TokenRes = { token: string; url: string; room: string };

export function VoiceRoom({
  enabled,
  onStatus,
}: {
  enabled: boolean;
  onStatus: (s: string) => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setConnected(false);
      onStatus("voice idle");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { token, url } = await api<TokenRes>("/v1/livekit/token", { method: "POST" });
        const room = new Room();
        room.on(RoomEvent.Disconnected, () => setConnected(false));
        await room.connect(url, token);
        const mic = await createLocalAudioTrack();
        await room.localParticipant.publishTrack(mic);
        if (cancelled) {
          mic.stop();
          room.disconnect();
          return;
        }
        roomRef.current = room;
        setConnected(true);
        onStatus(`LiveKit loopback · ${url}`);
      } catch (err) {
        onStatus(
          `LiveKit offline (${err instanceof Error ? err.message : "start livekit-server --dev"})`
        );
      }
    })();

    return () => {
      cancelled = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [enabled, onStatus]);

  return (
    <span style={{ color: connected ? "var(--accent)" : "var(--muted)", fontSize: 12 }}>
      {connected ? "mic in local room" : "room off"}
    </span>
  );
}
