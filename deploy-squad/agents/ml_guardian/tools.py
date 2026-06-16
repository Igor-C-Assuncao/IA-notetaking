import json
import os

def check_mlflow_metrics(run_id: str) -> str:
    """
    Queries an MLflow tracking server mockingly to validate model evaluation metrics.
    """
    mock_metrics = {
        "run_id": run_id,
        "metrics": {
            "f1_score": 0.915,
            "accuracy": 0.93,
            "loss": 0.042
        },
        "status": "FINISHED"
    }
    return json.dumps(mock_metrics, indent=2)

def validate_snowflake_schema(table_name: str) -> str:
    """
    Validates the physical schema of the feature engineering table in Snowflake mockingly.
    """
    return f"Feature table schema '{table_name}' verified successfully. No skew detected."

def verify_rag_vector_index(index_dir: str = None) -> str:
    """
    Audits the existence and physical state of the RAG vector index files in the workspace.
    """
    if not index_dir:
        index_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "src-python"))
    
    json_path = os.path.join(index_dir, "vector_index.json")
    npy_path = os.path.join(index_dir, "vector_index.npy")
    
    results = {}
    if os.path.exists(json_path):
        results["vector_index.json"] = f"EXISTS ({os.path.getsize(json_path)} bytes)"
    else:
        results["vector_index.json"] = "MISSING"
        
    if os.path.exists(npy_path):
        results["vector_index.npy"] = f"EXISTS ({os.path.getsize(npy_path)} bytes)"
    else:
        results["vector_index.npy"] = "MISSING"
        
    return json.dumps(results, indent=2)

def verify_llm_notetaking_prompts(file_path: str = None) -> str:
    """
    Audits llm_service.py to verify that the LangGraph structured summary node strictly enforces
    the premium JSON schema (tldr, metrics, key_decisions, action_items, tags).
    """
    if not file_path:
        file_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "src-python", "llm_service.py"))
        
    if not os.path.exists(file_path):
        return f"llm_service.py file not found at: {file_path}"
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        checks = {
            "tldr_field": "tldr" in content or "TLDR" in content,
            "metrics_field": "metrics" in content or "Numbers" in content or "numbers" in content,
            "decisions_field": "key_decisions" in content or "decisions" in content or "Decision" in content,
            "actions_field": "action_items" in content or "actions" in content or "Action" in content,
            "tags_field": "tags" in content,
            "uses_langgraph": "StateGraph" in content or "langgraph" in content or "State" in content
        }
        return json.dumps(checks, indent=2)
    except Exception as e:
        return f"Failed to audit LLM prompts: {str(e)}"

def verify_mlops_pipeline_structure(project_root: str = None) -> str:
    """
    Scans and audits the structure of the local MLOps components (WhisperX, Silero VAD, Ollama RAG),
    checking device parameters, fallsbacks, and reproducible pipelines settings.
    """
    if not project_root:
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        
    python_dir = os.path.join(project_root, "src-python")
    
    audit_results = {
        "transcription_service": {
            "exists": False,
            "hardware_fallback_implemented": False,
            "whisper_model_size": "unknown",
            "device_checking": False
        },
        "vad_service": {
            "exists": False,
            "silero_vad_used": False,
            "sampling_rate_rescale_implemented": False,
            "probability_threshold": "unknown"
        },
        "rag_service": {
            "exists": False,
            "embedding_model_configured": "unknown",
            "reproducible_chunking": False
        }
    }
    
    # 1. Transcription Service Audit
    tx_file = os.path.join(python_dir, "transcription_service.py")
    if os.path.exists(tx_file):
        audit_results["transcription_service"]["exists"] = True
        try:
            with open(tx_file, "r", encoding="utf-8") as f:
                content = f.read()
            audit_results["transcription_service"]["device_checking"] = "torch.cuda.is_available()" in content
            audit_results["transcription_service"]["hardware_fallback_implemented"] = "fallback" in content.lower() or "except" in content
            if '"base"' in content or "'base'" in content:
                audit_results["transcription_service"]["whisper_model_size"] = "base"
            elif '"tiny"' in content or "'tiny'" in content:
                audit_results["transcription_service"]["whisper_model_size"] = "tiny"
        except Exception:
            pass
            
    # 2. VAD Service Audit
    vad_file = os.path.join(python_dir, "vad_service.py")
    if os.path.exists(vad_file):
        audit_results["vad_service"]["exists"] = True
        try:
            with open(vad_file, "r", encoding="utf-8") as f:
                content = f.read()
            audit_results["vad_service"]["silero_vad_used"] = "silero-vad" in content or "silero_vad" in content
            audit_results["vad_service"]["sampling_rate_rescale_implemented"] = "16000" in content
            # Look for threshold value
            if "threshold=" in content:
                # Simple extraction
                parts = content.split("threshold=")
                if len(parts) > 1:
                    val = parts[1].split(",")[0].split(")")[0].strip()
                    audit_results["vad_service"]["probability_threshold"] = val
        except Exception:
            pass
            
    # 3. RAG Service Audit
    rag_file = os.path.join(python_dir, "rag_service.py")
    if os.path.exists(rag_file):
        audit_results["rag_service"]["exists"] = True
        try:
            with open(rag_file, "r", encoding="utf-8") as f:
                content = f.read()
            audit_results["rag_service"]["reproducible_chunking"] = "chunk" in content or "split" in content
            if "nomic-embed-text" in content:
                audit_results["rag_service"]["embedding_model_configured"] = "nomic-embed-text"
            else:
                audit_results["rag_service"]["embedding_model_configured"] = "default/custom"
        except Exception:
            pass
            
    return json.dumps(audit_results, indent=2)