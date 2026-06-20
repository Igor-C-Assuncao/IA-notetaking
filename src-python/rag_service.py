# src-python/rag_service.py
import json
import os
import urllib.request
import urllib.error
import numpy as np
from config import get_app_data_dir

class EmbeddingModelFactory:
    """
    Factory responsible for generating vector embeddings.
    Supports local Ollama API or self-contained Sentence-Transformers model.
    """
    @staticmethod
    def get_embeddings(text: str, provider: str, model_name: str) -> list:
        """
        Generates a vector embedding for the given text.
        Returns a list of floats (embedding vector).
        """
        if provider == "ollama":
            # Call local Ollama API
            url = "http://localhost:11434/api/embeddings"
            payload = {
                "model": model_name or "nomic-embed-text",
                "prompt": text
            }
            try:
                data = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    url,
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    res_data = json.loads(response.read().decode())
                    return res_data.get("embedding", [])
            except Exception as e:
                # Fallback to alternative '/api/embed' endpoint if 'embeddings' fails
                try:
                    url_alt = "http://localhost:11434/api/embed"
                    payload_alt = {
                        "model": model_name or "nomic-embed-text",
                        "input": text
                    }
                    data_alt = json.dumps(payload_alt).encode("utf-8")
                    req_alt = urllib.request.Request(
                        url_alt,
                        data=data_alt,
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req_alt, timeout=10) as response:
                        res_data = json.loads(response.read().decode())
                        embeddings = res_data.get("embeddings", [])
                        if embeddings and isinstance(embeddings, list):
                            return embeddings[0]
                except Exception as e_alt:
                    print(f"DEBUG: [Ollama Embedding Error] Failed to generate: {e_alt}")
                raise Exception(f"Failed to connect to local Ollama. Make sure Ollama is running and '{model_name}' is pulled. Error: {str(e)}")
        
        elif provider == "local":
            # Load and run local Sentence-Transformers model
            try:
                from sentence_transformers import SentenceTransformer
                # Lazy loading of model to optimize memory
                model = SentenceTransformer(model_name or "all-MiniLM-L6-v2")
                vector = model.encode(text)
                return vector.tolist()
            except Exception as e:
                print(f"DEBUG: [Local Embedding Error] Failed to import/run sentence-transformers: {e}")
                raise Exception(f"Failed to run local embedding engine. Make sure PyTorch and sentence-transformers are properly installed. Error: {str(e)}")
        
        else:
            raise ValueError(f"Unknown embedding provider: {provider}")


class RAGService:
    """
    RAG Service handling text chunking, local vector indexing, persistence, and cosine similarity search.
    """
    def __init__(self):
        rag_dir = get_app_data_dir() / "rag"
        rag_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = str(rag_dir / "vector_index.json")
        self.vectors_path = str(rag_dir / "vector_index.npy")
        
        self.chunks = []       # list of dict: {meeting_id, title, date, text}
        self.vectors = None    # numpy array: [N, D]
        self.load_index()

    def load_index(self):
        """Loads vector index and chunks metadata from disk if they exist."""
        if os.path.exists(self.index_path) and os.path.exists(self.vectors_path):
            try:
                with open(self.index_path, "r", encoding="utf-8") as f:
                    self.chunks = json.load(f)
                self.vectors = np.load(self.vectors_path)
                print(f"DEBUG: [RAG] Loaded vector index containing {len(self.chunks)} chunks.", flush=True)
            except Exception as e:
                print(f"DEBUG: [RAG Warning] Failed to load index from disk: {e}. Starting fresh.", flush=True)
                self.chunks = []
                self.vectors = None
        else:
            self.chunks = []
            self.vectors = None

    def save_index(self):
        """Saves current vector index and metadata to disk."""
        try:
            with open(self.index_path, "w", encoding="utf-8") as f:
                json.dump(self.chunks, f, ensure_ascii=False, indent=2)
            if self.vectors is not None:
                np.save(self.vectors_path, self.vectors)
            print(f"DEBUG: [RAG] Successfully saved index containing {len(self.chunks)} chunks to disk.", flush=True)
        except Exception as e:
            print(f"DEBUG: [RAG Error] Failed to save index: {e}", flush=True)

    def clear_index(self):
        """Resets the vector index entirely."""
        self.chunks = []
        self.vectors = None
        if os.path.exists(self.index_path):
            try:
                os.remove(self.index_path)
            except Exception:
                pass
        if os.path.exists(self.vectors_path):
            try:
                os.remove(self.vectors_path)
            except Exception:
                pass
        print("DEBUG: [RAG] Vector index cleared.", flush=True)

    def chunk_text(self, text: str, word_limit: int = 150, overlap: int = 50) -> list:
        """
        Chunks text into overlapping windows of words.
        Returns a list of text strings.
        """
        words = text.split()
        if len(words) <= word_limit:
            return [text]
        
        chunks = []
        i = 0
        while i < len(words):
            chunk_words = words[i:i + word_limit]
            chunks.append(" ".join(chunk_words))
            i += (word_limit - overlap)
        return chunks

    def index_meeting(self, meeting_id: int, title: str, date: str, raw_transcript: str, provider: str, model_name: str) -> int:
        """
        Chunks and vectorizes a single meeting. Appends it to the vector database.
        Returns the number of chunks successfully indexed.
        """
        # Remove any existing chunks for this meeting ID to prevent duplicates on re-index
        self.remove_meeting_chunks(meeting_id)

        chunks_text = self.chunk_text(raw_transcript)
        new_chunks = []
        new_vectors = []

        print(f"DEBUG: [RAG] Indexing meeting {meeting_id} ('{title}') into {len(chunks_text)} chunks...", flush=True)

        for chunk_text in chunks_text:
            if not chunk_text.strip():
                continue
            try:
                vector = EmbeddingModelFactory.get_embeddings(chunk_text, provider, model_name)
                if vector:
                    new_chunks.append({
                        "meeting_id": meeting_id,
                        "title": title,
                        "date": date,
                        "text": chunk_text
                    })
                    new_vectors.append(vector)
            except Exception as e:
                print(f"DEBUG: [RAG Error] Failed to embed chunk: {e}", flush=True)
                raise e

        if not new_chunks:
            return 0

        # Append new vectors and chunks to our memory state
        self.chunks.extend(new_chunks)
        new_vectors_np = np.array(new_vectors, dtype=np.float32)

        if self.vectors is None:
            self.vectors = new_vectors_np
        else:
            self.vectors = np.vstack([self.vectors, new_vectors_np])

        self.save_index()
        return len(new_chunks)

    def remove_meeting_chunks(self, meeting_id: int):
        """Removes all segments and vectors associated with a specific meeting ID."""
        if not self.chunks:
            return

        indices_to_keep = [i for i, chunk in enumerate(self.chunks) if chunk["meeting_id"] != meeting_id]
        if len(indices_to_keep) == len(self.chunks):
            return

        print(f"DEBUG: [RAG] Removing {len(self.chunks) - len(indices_to_keep)} old chunks for meeting {meeting_id}.", flush=True)
        
        self.chunks = [self.chunks[i] for i in indices_to_keep]
        if self.vectors is not None:
            if not indices_to_keep:
                self.vectors = None
            else:
                self.vectors = self.vectors[indices_to_keep]

    def query_similarity(self, query: str, provider: str, model_name: str, top_k: int = 5) -> list:
        """
        Performs vector cosine similarity search for the given query.
        Returns a list of matching chunks: [{meeting_id, title, date, text, score}]
        """
        if not self.chunks or self.vectors is None:
            print("DEBUG: [RAG] Query ignored — vector index is empty.", flush=True)
            return []

        try:
            q_vector = EmbeddingModelFactory.get_embeddings(query, provider, model_name)
        except Exception as e:
            print(f"DEBUG: [RAG Error] Failed to embed query: {e}", flush=True)
            return []

        if not q_vector:
            return []

        q = np.array(q_vector, dtype=np.float32)

        # Compute cosine similarity
        q_norm = q / (np.linalg.norm(q) + 1e-9)
        E_norms = np.linalg.norm(self.vectors, axis=1, keepdims=True) + 1e-9
        E_norm = self.vectors / E_norms

        similarities = np.dot(E_norm, q_norm)
        
        # Get Top-K matches
        top_indices = np.argsort(similarities)[::-1][:top_k]
        
        results = []
        for idx in top_indices:
            score = float(similarities[idx])
            # Only include chunks with a reasonable similarity score to avoid junk contexts
            if score > 0.15:
                chunk = self.chunks[idx].copy()
                chunk["score"] = round(score, 3)
                results.append(chunk)

        print(f"DEBUG: [RAG] Query '{query}' yielded {len(results)} matches.", flush=True)
        return results
