import { useState, useRef, useEffect, useCallback } from "react";

const API = "http://localhost:8000";

const api = {
  ask: (question, session_id, target_file) =>
    fetch(`${API}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, session_id, target_file: target_file || null }),
    }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).detail); return r.json(); }),
  sessions: () => fetch(`${API}/sessions`).then((r) => r.json()),
  session: (id) => fetch(`${API}/sessions/${id}`).then((r) => r.json()),
  deleteSession: async (id) => {
    const r = await fetch(`${API}/sessions/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error("Delete failed");
    return r.json();
  },
  renameSession: (id, title) =>
    fetch(`${API}/sessions/${id}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  files: () => fetch(`${API}/files`).then((r) => r.json()),
  upload: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API}/upload`, { method: "POST", body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || "Upload failed");
    return r.json();
  },
  deleteFile: (filename) =>
    fetch(`${API}/files/${encodeURIComponent(filename)}`, { method: "DELETE" }),
};

function timeAgo(iso) {
  if (!iso) return "";
  try {
    const d = Math.floor((Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z")) / 1000);
    if (d < 60) return "just now";
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86400)}d ago`;
  } catch { return ""; }
}

const SAMPLE_QUESTIONS = [
  { icon: "◎", label: "Summarize",       text: "Summarize the key points of my document" },
  { icon: "◈", label: "Conclusion",      text: "What is the main conclusion of this document?" },
  { icon: "◐", label: "Key Facts",       text: "List the most important facts mentioned" },
  { icon: "◑", label: "Overview",        text: "Give me a detailed overview of the content" },
  { icon: "◒", label: "Definitions",     text: "What are the key terms and definitions used?" },
  { icon: "◓", label: "Data & Stats",    text: "What data or statistics are mentioned?" },
  { icon: "◔", label: "Recommendations", text: "What recommendations does the document make?" },
  { icon: "◕", label: "Compare Topics",  text: "Compare and contrast the main topics covered" },
];

// ── Icons ─────────────────────────────────────────────────────────────────
const Ic = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const IcPlus    = () => <Ic d="M12 5v14M5 12h14" />;
const IcChat    = () => <Ic d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
const IcTrash   = () => <Ic d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />;
const IcEdit    = () => <Ic d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />;
const IcFile    = () => <Ic d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />;
const IcUpload  = () => <Ic d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />;
const IcSend    = () => <Ic d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />;
const IcChevron = ({ open }) => <Ic d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />;
const IcX       = () => <Ic d="M18 6L6 18M6 6l12 12" />;
const IcMenu    = () => <Ic d="M3 12h18M3 6h18M3 18h18" />;
const IcDoc     = () => <Ic d="M9 12h6M9 16h6M9 8h6M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />;
const IcCheck   = () => <Ic d="M20 6L9 17l-5-5" />;
const IcTarget  = () => <Ic d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />;
const IcSun     = () => <Ic d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z" />;
const IcMoon    = () => <Ic d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
const IcRefresh = () => <Ic d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />;

// ── Prose renderer ────────────────────────────────────────────────────────
function Prose({ text }) {
  if (!text) return null;
  return (
    <div className="prose">
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="prose-gap" />;
        if (/^\*\*(.+)\*\*$/.test(line)) return <p key={i} className="prose-bold">{line.slice(2, -2)}</p>;
        if (/^#{1,3} /.test(line)) return <p key={i} className="prose-heading">{line.replace(/^#+\s/, "")}</p>;
        if (/^[-•*] /.test(line)) return <div key={i} className="prose-li"><span className="prose-bullet">▸</span><span>{line.slice(2)}</span></div>;
        if (/^\d+\. /.test(line)) return <div key={i} className="prose-li"><span className="prose-bullet">{line.match(/^\d+/)[0]}.</span><span>{line.replace(/^\d+\.\s/, "")}</span></div>;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

// ── Sources ───────────────────────────────────────────────────────────────
function Sources({ chunks, targetFile }) {
  const [open, setOpen] = useState(false);
  if (!chunks?.length) return null;
  return (
    <div className="sources">
      <button className="sources-toggle" onClick={() => setOpen(!open)}>
        <IcDoc /><span>{chunks.length} source{chunks.length !== 1 ? "s" : ""}</span>
        {targetFile && <span className="source-file-badge">{targetFile}</span>}
        <IcChevron open={open} />
      </button>
      {open && (
        <div className="sources-list">
          {chunks.map((src, i) => (
            <div key={i} className="source-chip">
              <span className="source-num">{i + 1}</span>
              <p>{src.slice(0, 220)}{src.length > 220 ? "…" : ""}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Scope selector ────────────────────────────────────────────────────────
function ScopeSelector({ files, value, onChange }) {
  return (
    <div className="scope-selector">
      <IcTarget />
      <select className="scope-select" value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">All documents</option>
        {files.map((f) => <option key={f.filename} value={f.filename}>{f.filename}</option>)}
      </select>
    </div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────
function ConfirmModal({ title, message, onConfirm, onCancel }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon-wrap"><IcTrash /></div>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-msg">{message}</p>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="modal-confirm" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── File Manager ──────────────────────────────────────────────────────────
function FileManager({ files, onUpload, onDelete, uploading, onScope, activeScope }) {
  const [drag, setDrag] = useState(false);
  const fileInput = useRef();
  const ext = (n) => n.split(".").pop().toUpperCase();
  const extColor = (n) => ({ PDF: "#f87171", TXT: "#4ade80", MD: "#60a5fa" }[ext(n)] || "#8a9099");

  return (
    <div className="fm">
      <div className="fm-header">
        <IcFile /><span>Knowledge Base</span>
        {files.length > 0 && <span className="fm-count">{files.length}</span>}
      </div>
      <div
        className={`drop-zone ${drag ? "drag-over" : ""} ${uploading ? "uploading" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onUpload(f); }}
        onClick={() => !uploading && fileInput.current.click()}
      >
        <input ref={fileInput} type="file" accept=".txt,.pdf,.md" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) { onUpload(e.target.files[0]); e.target.value = null; } }} />
        {uploading
          ? <><div className="upload-spinner" /><span className="upload-hint">Processing…</span></>
          : <><IcUpload /><span className="upload-hint">Drop or click to upload</span><span className="upload-sub">.txt · .pdf · .md</span></>}
      </div>
      <div className="fm-files">
        {files.length === 0 && !uploading && <p className="fm-empty">No documents yet.<br />Upload files to begin.</p>}
        {files.map((f) => (
          <div key={f.filename} className={`fm-file ${activeScope === f.filename ? "scoped" : ""}`}>
            <span className="fm-ext-badge" style={{ background: extColor(f.filename) + "22", color: extColor(f.filename) }}>{ext(f.filename)}</span>
            <div className="fm-file-info">
              <span className="fm-file-name" title={f.filename}>{f.filename}</span>
              <span className="fm-file-meta">{f.chunks} chunks</span>
            </div>
            <div className="fm-file-actions">
              <button className={`scope-btn ${activeScope === f.filename ? "active" : ""}`}
                onClick={() => onScope(activeScope === f.filename ? null : f.filename)}><IcTarget /></button>
              <button className="icon-btn danger" onClick={() => onDelete(f.filename)}><IcTrash /></button>
            </div>
          </div>
        ))}
      </div>
      {activeScope && (
        <div className="scope-banner">
          <IcTarget /><span>Scoped: <strong>{activeScope}</strong></span>
          <button onClick={() => onScope(null)}><IcX /></button>
        </div>
      )}
    </div>
  );
}

// ── Session item ──────────────────────────────────────────────────────────
function SessionItem({ s, active, onSelect, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.title);
  const inp = useRef();
  useEffect(() => { if (editing) inp.current?.focus(); }, [editing]);
  const commit = () => { setEditing(false); if (draft.trim() && draft !== s.title) onRename(s.id, draft.trim()); };

  return (
    <div className={`session-item ${active ? "active" : ""}`} onClick={() => !editing && onSelect(s.id)}>
      <div className="session-icon"><IcChat /></div>
      <div className="session-body">
        {editing
          ? <input ref={inp} className="session-rename-input" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
              onBlur={commit} onClick={(e) => e.stopPropagation()} />
          : <span className="session-title">{s.title || "Untitled"}</span>}
        <span className="session-meta">{Math.floor(s.message_count / 2)} Q&A · {timeAgo(s.last_updated)}</span>
      </div>
      <div className="session-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setEditing(true); }}><IcEdit /></button>
        <button className="icon-btn danger" onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}><IcTrash /></button>
      </div>
    </div>
  );
}

// ── Message ───────────────────────────────────────────────────────────────
function Message({ msg }) {
  // HITL System message rendering
  if (msg.role === "system") {
    return (
      <div style={{ textAlign: "center", margin: "16px 0", fontSize: "12px", fontWeight: "600", color: "#64748b" }}>
        <span style={{ background: "#f1f5f9", padding: "6px 14px", borderRadius: "20px", border: "1px solid #e2e8f0" }}>{msg.content}</span>
      </div>
    );
  }

  const isUser = msg.role === "user";
  return (
    <div className={`msg-row ${isUser ? "user" : "assistant"}`}>
      <div className="msg-avatar">{isUser ? "U" : "AI"}</div>
      <div className="msg-bubble">
        {isUser ? <p className="user-text">{msg.content}</p> : <Prose text={msg.content} />}
        {!isUser && <Sources chunks={msg.sources} targetFile={msg.target_file} />}
        <div className="msg-footer">
          {msg.target_file && <span className="msg-scope-tag"><IcTarget />{msg.target_file}</span>}
          <span className="msg-time">
            {msg.timestamp
              ? new Date((msg.timestamp.endsWith("Z") ? msg.timestamp : msg.timestamp + "Z"))
                  .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Welcome screen with sample questions ─────────────────────────────────
function WelcomeScreen({ onSelect, files }) {
  const [questions, setQuestions] = useState(() =>
    [...SAMPLE_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 6)
  );
  const shuffle = () => setQuestions([...SAMPLE_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 6));

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-orb">
          <div className="orb-ring r1" /><div className="orb-ring r2" /><div className="orb-ring r3" />
          <span className="orb-glyph">◈</span>
        </div>
        <h1 className="welcome-title">RAG Studio</h1>
        <p className="welcome-sub">
          {files.length > 0
            ? `${files.length} document${files.length !== 1 ? "s" : ""} ready — ask anything below`
            : "Upload documents in the Files tab, then ask questions grounded in your data"}
        </p>
      </div>

      <div className="sample-section">
        <div className="sample-header">
          <span className="sample-label">✦ Try asking…</span>
          <button className="shuffle-btn" onClick={shuffle}><IcRefresh /> Shuffle</button>
        </div>
        <div className="sample-grid">
          {questions.map((q) => (
            <button key={q.text} className="sample-card" onClick={() => onSelect(q.text)}>
              <span className="sample-card-icon">{q.icon}</span>
              <div className="sample-card-body">
                <span className="sample-card-label">{q.label}</span>
                <span className="sample-card-text">{q.text}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="tips-row">
        {[
          ["◎", "Scope to file", "Click ⊙ on any file to query it specifically"],
          ["◐", "Drag & drop", "Drop .pdf, .txt, .md files to ingest"],
          ["◑", "Multi-line", "Shift+Enter to write multi-line questions"],
        ].map(([glyph, title, desc]) => (
          <div key={title} className="tip-card">
            <span className="tip-glyph">{glyph}</span>
            <div><span className="tip-title">{title}</span><span className="tip-desc">{desc}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("rag-theme") || "dark");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab, setTab] = useState("chats");
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeScope, setActiveScope] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const bottomRef = useRef();
  const textareaRef = useRef();

  // HITL State Logic
  const isEscalated = messages.length > 0 
    && messages[messages.length - 1].needs_human 
    && messages[messages.length - 1].role !== "system";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rag-theme", theme);
  }, [theme]);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };
  const loadSessions = useCallback(async () => { try { setSessions(await api.sessions()); } catch {} }, []);
  const loadFiles = useCallback(async () => { try { setFiles(await api.files()); } catch {} }, []);

  useEffect(() => { loadSessions(); loadFiles(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const selectSession = async (id) => {
    setActiveId(id);
    try { const d = await api.session(id); setMessages(d.messages || []); }
    catch { showToast("Failed to load session", "error"); }
  };

  const newChat = () => { setActiveId(null); setMessages([]); setInput(""); };

  const sendMessage = async (overrideText) => {
    const q = (overrideText !== undefined ? overrideText : input).trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);
    const ts = new Date().toISOString();
    const optimistic = { id: "tmp-" + Date.now(), role: "user", content: q, timestamp: ts, target_file: activeScope };
    setMessages((p) => [...p, optimistic]);
    try {
      const data = await api.ask(q, activeId, activeScope);
      if (!activeId) setActiveId(data.session_id);
      setMessages((p) => [
        ...p.filter((m) => m.id !== optimistic.id),
        { id: "u-" + Date.now(), role: "user", content: q, timestamp: ts, target_file: activeScope },
        // ADDED: Capture needs_human flag from backend
        { id: "a-" + Date.now(), role: "assistant", content: data.answer, sources: data.sources, timestamp: new Date().toISOString(), target_file: activeScope, needs_human: data.needs_human },
      ]);
      loadSessions();
    } catch (e) {
      setMessages((p) => p.filter((m) => m.id !== optimistic.id));
      showToast(e.message || "Failed to get response", "error");
    } finally { setLoading(false); }
  };

  // ADDED: Allows user to cancel the HITL state
  const cancelEscalation = () => {
    setMessages(prev => [
      ...prev, 
      { id: "sys-" + Date.now(), role: "system", content: "Human agent disconnected. Automated RAG bot resumed." }
    ]);
  };

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const handleUpload = async (file) => {
    if (uploading) return;
    setUploading(true);
    try { const res = await api.upload(file); showToast(`"${file.name}" — ${res.chunks_ingested} chunks ingested`); loadFiles(); }
    catch (err) { showToast(err.message || "Upload failed", "error"); }
    finally { setUploading(false); }
  };

  const handleDeleteFile = async (filename) => {
    try { await api.deleteFile(filename); showToast(`"${filename}" removed`); if (activeScope === filename) setActiveScope(null); loadFiles(); }
    catch { showToast("Delete failed", "error"); }
  };

  const handleDeleteSession = (id) => {
    const s = sessions.find((x) => x.id === id);
    setConfirmDelete({ id, title: s?.title || "this chat" });
  };

  const confirmDeleteSession = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setConfirmDelete(null);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (id === activeId) newChat();
    try { await api.deleteSession(id); showToast("Chat deleted"); }
    catch { showToast("Failed to delete", "error"); loadSessions(); }
  };

  const handleRename = async (id, title) => {
    try { await api.renameSession(id, title); loadSessions(); }
    catch { showToast("Rename failed", "error"); }
  };

  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="sidebar-top">
          <div className="logo">
            <div className="logo-mark">R</div>
            {sidebarOpen && <span className="logo-text">RAG Studio</span>}
          </div>
          {sidebarOpen && (
            <div className="sidebar-top-btns">
              <button className="icon-btn" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} title="Toggle theme">
                {theme === "dark" ? <IcSun /> : <IcMoon />}
              </button>
              <button className="icon-btn" onClick={() => setSidebarOpen(false)}><IcMenu /></button>
            </div>
          )}
        </div>

        {sidebarOpen && <>
          <button className="new-chat-btn" onClick={newChat}><IcPlus /><span>New Chat</span></button>
          <div className="tab-row">
            <button className={`tab-btn ${tab === "chats" ? "active" : ""}`} onClick={() => setTab("chats")}><IcChat />Chats</button>
            <button className={`tab-btn ${tab === "files" ? "active" : ""}`} onClick={() => setTab("files")}>
              <IcFile />Files{files.length > 0 && <span className="tab-count">{files.length}</span>}
            </button>
          </div>
          {tab === "chats"
            ? <div className="session-list">
                {sessions.length === 0 && <p className="sidebar-empty">No chats yet.<br />Start a conversation below.</p>}
                {[...sessions].reverse().map((s) => (
                  <SessionItem key={s.id} s={s} active={s.id === activeId}
                    onSelect={selectSession} onDelete={handleDeleteSession} onRename={handleRename} />
                ))}
              </div>
            : <FileManager files={files} onUpload={handleUpload} onDelete={handleDeleteFile}
                uploading={uploading} onScope={setActiveScope} activeScope={activeScope} />
          }
        </>}
      </aside>

      <main className="main">
        <header className="chat-header">
          <div className="header-left">
            {/* FIX: flexShrink: 0 and minWidth prevent the button from being squished! */}
            {!sidebarOpen && (
              <button className="icon-btn" onClick={() => setSidebarOpen(true)} style={{ marginRight: '12px', flexShrink: 0, minWidth: '40px' }} title="Open Sidebar">
                <IcMenu />
              </button>
            )}
            <span className="header-title">{activeSession?.title || (activeId ? "Chat" : "New Conversation")}</span>
            {activeScope && (
              <div className="header-scope">
                <IcTarget /><span>{activeScope}</span>
                <button onClick={() => setActiveScope(null)}><IcX /></button>
              </div>
            )}
          </div>
          <div className="header-right">
            {!sidebarOpen && (
              <button className="icon-btn" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <IcSun /> : <IcMoon />}
              </button>
            )}
            <div className="conn-badge"><div className="conn-dot" /><span>Live</span></div>
          </div>
        </header>

        <div className="messages">
          {messages.length === 0
            ? <WelcomeScreen onSelect={(text) => { setInput(text); textareaRef.current?.focus(); }} files={files} />
            : messages.map((msg) => <Message key={msg.id} msg={msg} />)}
          {loading && (
            <div className="msg-row assistant">
              <div className="msg-avatar">AI</div>
              <div className="msg-bubble"><div className="typing"><span /><span /><span /></div></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="input-area">
          {/* ADDED: HITL Escalation UI */}
          {isEscalated ? (
            <div className="escalation-banner" style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: "20px", padding: "16px", display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ color: "#be123c", margin: 0, fontSize: "15px" }}>Human-in-the-Loop Triggered</h4>
                <p style={{ color: "#9f1239", margin: 0, fontSize: "13px" }}>Your chat is locked. Please wait for an agent to connect to your session.</p>
              </div>
              <button onClick={cancelEscalation} style={{ background: "white", border: "1px solid #fecdd3", color: "#be123c", padding: "8px 16px", borderRadius: "16px", cursor: "pointer", fontWeight: "bold" }}>
                Cancel Escalation
              </button>
            </div>
          ) : (
            <>
              {files.length > 0 && (
                <div className="input-scope-row">
                  <ScopeSelector files={files} value={activeScope} onChange={setActiveScope} />
                  {activeScope && (
                    <div className="active-scope-pill">
                      <IcTarget /><span>{activeScope}</span>
                      <button onClick={() => setActiveScope(null)}><IcX /></button>
                    </div>
                  )}
                </div>
              )}
              <div className="input-bar">
                <textarea ref={textareaRef} className="chat-input"
                  placeholder={activeScope ? `Ask about "${activeScope}"…` : "Ask about your documents… (Enter to send)"}
                  value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} rows={1}
                  onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }} />
                <button className={`send-btn ${loading || !input.trim() ? "dim" : ""}`}
                  onClick={() => sendMessage()} disabled={loading || !input.trim()}><IcSend /></button>
              </div>
              <p className="input-hint">Shift+Enter for newline · {activeScope ? `Scoped to ${activeScope}` : "All documents"}</p>
            </>
          )}
        </div>
      </main>

      {confirmDelete && (
        <ConfirmModal title="Delete Chat" message={`Delete "${confirmDelete.title}"? This cannot be undone.`}
          onConfirm={confirmDeleteSession} onCancel={() => setConfirmDelete(null)} />
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === "success" ? <IcCheck /> : <IcX />}<span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}