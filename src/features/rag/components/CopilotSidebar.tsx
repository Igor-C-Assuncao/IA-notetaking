import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "@app/providers/SettingsProvider";
import { useTheme } from "@app/providers/ThemeProvider";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { Meeting } from "@features/meetings/hooks/useMeetings";

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
}

interface CopilotSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  meetingsHistory: Meeting[];
  setSelectedMeetingId: (id: number | null) => void;
}

export function CopilotSidebar({ isOpen, onClose, meetingsHistory, setSelectedMeetingId }: CopilotSidebarProps) {
  const { settings } = useSettings();
  const { isLG } = useTheme();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "assistant",
      text: "Hello! I am your AI Copilot. Ask me anything about your past meetings, and I will search your local history to answer you with full citations.",
      timestamp: new Date()
    }
  ]);
  
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages or thinking state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Handle stdout streaming chunks from Python
  usePythonEvent("COPILOT_STREAM", (data) => {
    setIsThinking(false);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.id === "temp-assistant") {
        return [
          ...prev.slice(0, -1),
          { ...last, text: last.text + (data.chunk || "") }
        ];
      }
      return prev;
    });
  });

  usePythonEvent("COPILOT_COMPLETED", (data) => {
    setIsThinking(false);
    if (!data.success && data.error) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id === "temp-assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, text: last.text + `\n\n❌ Error: ${data.error}` }
          ];
        }
        return prev;
      });
    }
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isThinking) return;

    const userText = input.trim();
    setInput("");

    // Add user message & placeholder assistant message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: userText,
      timestamp: new Date()
    };

    const assistantPlaceholder: Message = {
      id: "temp-assistant",
      sender: "assistant",
      text: "",
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setIsThinking(true);

    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({
          action: "COPILOT_QUERY",
          query: userText,
          provider: settings.provider,
          model: settings.modelName,
          api_key: settings.apiKey,
          system_prompt: settings.systemPrompt,
          embedding_provider: settings.ragProvider,
          embedding_model: settings.ragEmbeddingModel
        })
      });
    } catch (err) {
      setIsThinking(false);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          id: `err-${Date.now()}`,
          sender: "assistant",
          text: `❌ Failed to communicate with AI engine: ${String(err)}`,
          timestamp: new Date()
        }
      ]);
    }
  };

  const handleClear = () => {
    if (confirm("Clear Copilot chat history?")) {
      setMessages([
        {
          id: "welcome",
          sender: "assistant",
          text: "Hello! I am your AI Copilot. Ask me anything about your past meetings, and I will search your local history to answer you.",
          timestamp: new Date()
        }
      ]);
    }
  };

  // Helper to parse text into blocks of plain text and interactive citation pills
  const renderMessageContent = (text: string) => {
    if (!text) return null;

    // Pattern matching [Meeting Title](date or id or date-string)
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add preceding plain text
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      const title = match[1];
      const dateVal = match[2];

      // Try to find matching meeting in history
      const matchedMeeting = meetingsHistory.find((m) => {
        const titleMatch = m.title.toLowerCase().includes(title.toLowerCase()) || title.toLowerCase().includes(m.title.toLowerCase());
        const dateMatch = m.date.includes(dateVal) || dateVal.includes(m.date.split(" ")[0]);
        return titleMatch || dateMatch;
      });

      parts.push({
        isCitation: true,
        title,
        date: dateVal,
        meetingId: matchedMeeting?.id || null
      });

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    if (parts.length === 0) return <p className="copilot-text">{text}</p>;

    return (
      <p className="copilot-text" style={{ whiteSpace: "pre-wrap", lineHeight: "1.5" }}>
        {parts.map((part, index) => {
          if (typeof part === "string") {
            return part;
          }
          if (part.isCitation) {
            return (
              <button
                key={index}
                className="citation-pill"
                onClick={() => {
                  if (part.meetingId) {
                    setSelectedMeetingId(part.meetingId);
                  } else {
                    alert(`Meeting "${part.title}" (${part.date}) was cited but is not loaded in history.`);
                  }
                }}
                title={`Open referenced meeting: ${part.title}`}
              >
                🗂️ {part.title} ({part.date.split(" ")[0]})
              </button>
            );
          }
          return null;
        })}
      </p>
    );
  };

  if (!isOpen) return null;

  return (
    <div className={`copilot-sidebar ${isLG ? "glass-theme" : "notebook-theme"}`}>
      <div className="copilot-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="copilot-icon">🤖</span>
          <span className="copilot-title">AI Copilot</span>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button className="copilot-header-btn" onClick={handleClear} title="Clear Conversation">
            🧹
          </button>
          <button className="copilot-header-btn" onClick={onClose} title="Close Sidebar">
            ✕
          </button>
        </div>
      </div>

      <div className="copilot-body">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble-wrapper ${msg.sender}`}>
            <div className="chat-bubble-sender">
              {msg.sender === "user" ? "You" : "Copilot"}
            </div>
            <div className="chat-bubble">
              {renderMessageContent(msg.text)}
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="chat-bubble-wrapper assistant">
            <div className="chat-bubble-sender">Copilot</div>
            <div className="chat-bubble thinking-bubble">
              <div className="thinking-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="copilot-footer" onSubmit={handleSend}>
        <input
          type="text"
          className="copilot-input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isThinking ? "Thinking..." : "Ask about your meetings..."}
          disabled={isThinking}
        />
        <button
          type="submit"
          className="copilot-send-btn"
          disabled={!input.trim() || isThinking}
        >
          ➔
        </button>
      </form>
    </div>
  );
}
