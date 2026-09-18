"use client";

import { useEffect, useState } from "react";
import { LocalChat } from "@/components/LocalChat";

export default function ChatPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div className="chat-shell" />;
  return <LocalChat />;
}
