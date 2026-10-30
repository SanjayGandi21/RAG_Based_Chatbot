import os
import uuid
from fastapi.staticfiles import StaticFiles
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
from fastapi.staticfiles import StaticFiles

from ingest import ingest_bytes, list_ingested_files, delete_file_chunks
from rag_pipeline import ask

app = FastAPI()

# Relaxed CORS for development to prevent "Upload Failed"
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for chat sessions
chat_sessions = {}
session_titles = {}

# --- Pydantic Models ---
class QueryRequest(BaseModel):
    question: str
    session_id: Optional[str] = None
    target_file: Optional[str] = None

class RenameRequest(BaseModel):
    title: str 

# --- Endpoints ---

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in {".pdf", ".txt", ".md"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="File is empty")
            
        chunks = ingest_bytes(contents, file.filename, ext)
        return {"filename": file.filename, "chunks_ingested": chunks}
    except Exception as e:
        print(f"Error during upload: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await file.close()

@app.post("/ask")
async def ask_question(req: QueryRequest):
    res = ask(req.question, req.target_file)
    sid = req.session_id or str(uuid.uuid4())
    
    if sid not in chat_sessions:
        chat_sessions[sid] = []
        session_titles[sid] = req.question[:30] + ("..." if len(req.question) > 30 else "")

    now = datetime.now(timezone.utc).isoformat()
    msg_pair = [
        {"role": "user", "content": req.question, "timestamp": now, "target_file": req.target_file},
        {
            "role": "assistant", 
            "content": res["answer"], 
            "sources": res.get("sources", []), 
            "timestamp": now, 
            "target_file": req.target_file,
            "needs_human": res.get("needs_human", False)
        }
    ]
    chat_sessions[sid].extend(msg_pair)
    
    return {
        "answer": res["answer"], 
        "sources": res.get("sources", []), 
        "session_id": sid,
        "needs_human": res.get("needs_human", False)
    }

@app.get("/sessions")
def get_sessions():
    sessions_list = []
    for sid, messages in chat_sessions.items():
        last_updated = messages[-1]["timestamp"] if messages else datetime.now(timezone.utc).isoformat()
        sessions_list.append({
            "id": sid, 
            "title": session_titles.get(sid, "Untitled"),
            "message_count": len(messages),
            "last_updated": last_updated
        })
    return sessions_list


@app.get("/sessions/{sid}")
def get_session(sid: str):
    return {"messages": chat_sessions.get(sid, [])}


@app.delete("/sessions/{sid}")
def delete_session(sid: str):
    if sid in chat_sessions:
        del chat_sessions[sid]
    if sid in session_titles:
        del session_titles[sid]
    return {"status": "success", "message": "Session deleted"}


@app.patch("/sessions/{sid}/rename")
def rename_session(sid: str, req: RenameRequest):
    if sid in session_titles:
        session_titles[sid] = req.title
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Session not found")


@app.get("/files")
def get_files():
    return list_ingested_files()


@app.delete("/files/{filename}")
def delete_file(filename: str):
    return {"deleted": delete_file_chunks(filename)}

# Serve React frontend only when production build exists
STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=str(STATIC_DIR), html=True),
        name="frontend"
    )