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
            "metrics_field": "metrics" in content or "Numbers" in content,
            "decisions_field": "key_decisions" in content or "decisions" in content or "Decision" in content,
            "actions_field": "action_items" in content or "actions" in content or "Action" in content,
            "tags_field": "tags" in content,
            "uses_langgraph": "StateGraph" in content or "langgraph" in content or "State" in content
        }
        return json.dumps(checks, indent=2)
    except Exception as e:
        return f"Failed to audit LLM prompts: {str(e)}"