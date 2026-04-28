import os
import io
import chromadb
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
from pypdf.errors import PdfStreamError

# Initialize Chroma and Embedding Model
# This will create a 'chroma_db' folder in your directory if it doesn't exist
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("rag_docs")
embedder = SentenceTransformer("all-MiniLM-L6-v2")

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Splits text into chunks. Uses word count for basic semantic preservation."""
    if not text or not text.strip():
        return []
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i : i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
    return chunks

def ingest_bytes(contents: bytes, filename: str, ext: str) -> int:
    """
    Ingest raw bytes into the vector database.
    Includes safety checks for corrupted streams and HTML masquerading as PDF.
    """
    text = ""
    
    # 1. EMPTY CONTENT CHECK
    if not contents or len(contents) == 0:
        raise ValueError("The uploaded file is empty (0 bytes).")

    # 2. TEXT & MARKDOWN PROCESSING
    if ext in [".txt", ".md"]:
        try:
            text = contents.decode("utf-8", errors="ignore")
        except Exception as e:
            raise ValueError(f"Failed to decode text file: {e}")
            
    # 3. PDF PROCESSING
    elif ext == ".pdf":
        # Check for HTML/Web error pages masquerading as PDF
        # PDFs must start with %PDF-
        if contents.strip().startswith(b"<") or b"<!DOCTYPE html>" in contents[:100]:
            raise ValueError("Data received is HTML/Text, not a PDF. Ensure your API URL is correct.")

        try:
            # Create a byte stream
            stream = io.BytesIO(contents)
            
            # strict=False is critical; it allows pypdf to fix minor trailer issues
            reader = PdfReader(stream, strict=False)
            
            pages_text = []
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    pages_text.append(extracted)
            
            text = "\n".join(pages_text)
            
            if not text.strip():
                raise ValueError("PDF contains no extractable text. It might be a scanned image (needs OCR).")
                
        except PdfStreamError:
            raise ValueError("The PDF stream ended unexpectedly. The file may be truncated or corrupted.")
        except Exception as e:
            raise ValueError(f"PDF Parsing Failed: {str(e)}")
            
    else:
        raise ValueError(f"Unsupported file extension: {ext}")

    # 4. CHUNKING & EMBEDDING
    chunks = chunk_text(text)
    if not chunks:
        return 0

    # Generate embeddings (Vectorization)
    embeddings = embedder.encode(chunks).tolist()
    
    # Create unique IDs and metadata for each chunk
    import uuid
    ids = [f"{filename}_{uuid.uuid4()}" for _ in range(len(chunks))]
    
    # Attach filename to metadata so we can delete/list files easily
    metadatas = [{"filename": filename} for _ in range(len(chunks))]
    
    # Store in ChromaDB
    collection.upsert(
        documents=chunks, 
        embeddings=embeddings, 
        ids=ids, 
        metadatas=metadatas
    )

    return len(chunks)

def list_ingested_files() -> list[dict]:
    """Retrieves unique filenames and their chunk counts from ChromaDB."""
    # Fetch all metadatas from the collection
    results = collection.get(include=["metadatas"])
    metadatas = results.get("metadatas", [])
    
    file_map = {}
    for meta in metadatas:
        fname = meta.get("filename")
        if fname:
            file_map[fname] = file_map.get(fname, 0) + 1
            
    return [{"filename": k, "chunks": v} for k, v in file_map.items()]

def delete_file_chunks(filename: str) -> int:
    """Deletes all vector entries associated with a specific filename."""
    # Filter by the 'filename' metadata key
    results = collection.get(
        where={"filename": filename}
    )
    
    ids_to_delete = results.get("ids", [])
    if ids_to_delete:
        collection.delete(ids=ids_to_delete)
        
    return len(ids_to_delete)

def ingest_file(filepath: str):
    """Utility function for local file ingestion via terminal."""
    ext = os.path.splitext(filepath)[1].lower()
    with open(filepath, "rb") as f:
        contents = f.read()
    return ingest_bytes(contents, os.path.basename(filepath), ext)

if __name__ == "__main__":
    # If run directly, ingest everything in the ./data folder
    data_dir = "./data"
    if os.path.exists(data_dir):
        for filename in os.listdir(data_dir):
            if filename.endswith((".pdf", ".txt", ".md")):
                try:
                    count = ingest_file(os.path.join(data_dir, filename))
                    print(f"Ingested {count} chunks from {filename}")
                except Exception as e:
                    print(f"Error ingesting {filename}: {e}")