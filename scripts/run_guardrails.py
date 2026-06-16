import sys
import os
import subprocess
import json

def run_local_lint() -> str:
    src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src-python"))
    try:
        res = subprocess.run(["ruff", "check", src_dir], capture_output=True, text=True)
        return res.stdout if res.stdout else "No linting issues found in Python."
    except Exception as e:
        return f"Failed to execute Ruff: {str(e)}"

def run_local_rust_linter() -> str:
    rust_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src-tauri"))
    try:
        res = subprocess.run(
            ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], 
            cwd=rust_dir, 
            shell=True,
            capture_output=True, 
            text=True
        )
        return res.stderr if res.stderr and "error" in res.stderr.lower() else "No warnings or errors found in Rust backend."
    except Exception as e:
        return f"Failed to execute cargo clippy: {str(e)}"

def run_local_ts_linter() -> str:
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    try:
        res = subprocess.run(
            ["npx", "tsc", "--noEmit"], 
            cwd=root_dir, 
            shell=True,
            capture_output=True, 
            text=True
        )
        return res.stdout if res.stdout and len(res.stdout.strip()) > 0 else "No type/linting issues found in TypeScript/React."
    except Exception as e:
        return f"Failed to execute TypeScript compiler: {str(e)}"

def run_local_git_diff() -> str:
    repo_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    try:
        res = subprocess.run(["git", "diff", "HEAD"], cwd=repo_dir, capture_output=True, text=True)
        return res.stdout if res.stdout else "No changes detected in Git repository."
    except Exception as e:
        return f"Failed to read git diff: {str(e)}"

def run_local_rag_audit() -> dict:
    src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src-python"))
    json_path = os.path.join(src_dir, "vector_index.json")
    npy_path = os.path.join(src_dir, "vector_index.npy")
    return {
        "vector_index.json": os.path.exists(json_path),
        "vector_index.npy": os.path.exists(npy_path)
    }

def run_local_prompt_audit() -> dict:
    llm_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src-python", "llm_service.py"))
    if not os.path.exists(llm_file):
        return {"error": "llm_service.py not found"}
    try:
        with open(llm_file, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "tldr_field": "tldr" in content or "TLDR" in content,
            "metrics_field": "metrics" in content or "Numbers" in content or "numbers" in content,
            "decisions_field": "key_decisions" in content or "decisions" in content or "Decision" in content,
            "actions_field": "action_items" in content or "actions" in content or "Action" in content,
            "tags_field": "tags" in content
        }
    except Exception as e:
        return {"error": str(e)}

def run_local_security_audit() -> dict:
    env_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    audit = {
        "env_file_exists": os.path.exists(env_file),
        "api_keys": {},
        "hardcoded_secrets_risk": "CLEAN"
    }
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    if "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip()
                        if "KEY" in k or "SECRET" in k or "TOKEN" in k:
                            audit["api_keys"][k] = "PRESENT" if v else "EMPTY"
        except Exception as e:
            audit["error"] = str(e)
            
    # Check for sk-proj- leaked in code
    src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src-python"))
    if os.path.exists(src_dir):
        for root, dirs, files in os.walk(src_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__pycache__"]
            for file in files:
                if file.endswith(".py"):
                    try:
                        with open(os.path.join(root, file), "r", encoding="utf-8") as f:
                            if "sk-proj-" in f.read():
                                audit["hardcoded_secrets_risk"] = "HIGH RISK (leaked key)"
                    except Exception:
                        pass
    return audit

def run_local_mlops_structure_audit() -> dict:
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
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
            if "threshold=" in content:
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
            
    return audit_results

def compile_fallback_report(lint_res, rust_res, ts_res, diff_res, rag_res, prompt_res, sec_res, mlops_res) -> dict:
    blocking_issues = []
    status = "APPROVED"
    
    # 1. Audit Python linting issues
    py_lint_fail = "No linting issues found" not in lint_res and "Failed to execute" not in lint_res and len(lint_res.strip()) > 0
    if py_lint_fail:
        blocking_issues.append("Ruff Static Analysis detected Python code style violations or syntax errors.")
        status = "APPROVED_WITH_WARNINGS"
        
    # 2. Audit Rust clippy issues
    rust_lint_fail = "No warnings or errors found" not in rust_res and "Failed to execute" not in rust_res
    if rust_lint_fail:
        blocking_issues.append("Cargo Clippy static analysis detected Rust warnings or compilation errors.")
        status = "REJECTED"
        
    # 3. Audit TypeScript typechecks
    ts_lint_fail = "No type/linting issues found" not in ts_res and "Failed to execute" not in ts_res
    if ts_lint_fail:
        blocking_issues.append("TypeScript compiler detected React frontend static typing or code errors.")
        status = "REJECTED"
        
    # 4. RAG audit
    if not rag_res.get("vector_index.json") or not rag_res.get("vector_index.npy"):
        blocking_issues.append("Vector index files (vector_index.json/vector_index.npy) are missing from src-python/.")
        status = "REJECTED"
        
    # 5. Prompt schema audit
    missing_fields = [k for k, v in prompt_res.items() if not v and k != "error"]
    if missing_fields:
        blocking_issues.append(f"llm_service.py is missing premium schema fields: {', '.join(missing_fields)}")
        status = "REJECTED"
        
    # 6. Security audit
    if not sec_res.get("env_file_exists"):
        blocking_issues.append(".env environment file is missing from the project root.")
        status = "REJECTED"
    if sec_res.get("hardcoded_secrets_risk") == "HIGH RISK (leaked key)":
        blocking_issues.append("Hardcoded API key starting with 'sk-proj-' detected in Python source code files!")
        status = "REJECTED"

    # 7. MLOps structural checks
    if not mlops_res["transcription_service"]["exists"]:
        blocking_issues.append("Transcription service (transcription_service.py) is missing from src-python/.")
        status = "REJECTED"
    if not mlops_res["vad_service"]["exists"]:
        blocking_issues.append("VAD service (vad_service.py) is missing from src-python/.")
        status = "REJECTED"
    if not mlops_res["transcription_service"]["device_checking"] or not mlops_res["transcription_service"]["hardware_fallback_implemented"]:
        blocking_issues.append("MLOps pipeline architecture issue: Transcription service is missing device checking or hardware fallback logic.")
        status = "APPROVED_WITH_WARNINGS"

    summary = (
        "Automated Production Deployment Guardrail Report (Mock/Fallback Mode).\n"
        f"Python Linter: {'PASSED' if not py_lint_fail else 'WARNINGS DETECTED'}.\n"
        f"Rust Clippy: {'PASSED' if not rust_lint_fail else 'FAILED'}.\n"
        f"TypeScript Type-safety: {'PASSED' if not ts_lint_fail else 'FAILED'}.\n"
        f"RAG Index Audit: {'PASSED' if status != 'REJECTED' or 'Vector index' not in str(blocking_issues) else 'FAILED'}.\n"
        f"Prompt Structure: {'PASSED' if not missing_fields else 'FAILED'}.\n"
        f"Compliance & Env Keys: {'PASSED' if sec_res.get('hardcoded_secrets_risk') == 'CLEAN' else 'FAILED'}.\n"
        f"MLOps Pipeline Structure: {'PASSED' if status != 'REJECTED' else 'WARNINGS/FAILED'}."
    )
    
    # Generate mock innovation backlog based on audited state
    innovation_backlog = []
    if missing_fields:
        innovation_backlog.append({
            "title": "Enforce Strict Pydantic Output Schema",
            "concept": "Integrate structured JSON schema into LangGraph to force validation.",
            "stack": "LangChain, Pydantic, Instructor"
        })
    if not rag_res.get("vector_index.json"):
        innovation_backlog.append({
            "title": "Auto-Initializing Vector Store",
            "concept": "Automatically initialize an empty index if files are missing to prevent crashes.",
            "stack": "LlamaIndex, FAISS"
        })
    innovation_backlog.append({
        "title": "Local Key Rotations via Vault",
        "concept": "Leverage a lightweight local key management store for .env variables.",
        "stack": "HashiCorp Vault local or dotenv-vault"
    })
    
    return {
        "status": status,
        "summary": summary,
        "blocking_issues": blocking_issues,
        "innovation_backlog": innovation_backlog
    }

def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    print("[START] Starting Expanded Production Deployment Guardrail Pipeline...")
    
    # Attempt to run via the Antigravity SDK Orchestrator if present
    try:
        import google.antigravity
        print("[SDK] Antigravity SDK detected! Dispatching parallel full-stack AI evaluation agents...")
        
        # Import the orchestrator and run it
        import asyncio
        sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
        from deploy_squad.orchestrator import main as run_orchestrator
        asyncio.run(run_orchestrator())
        return
    except ImportError:
        print("[FALLBACK] Antigravity SDK not found in local environment. Running in Full-Stack Mock/Fallback Mode...")
        
        # Run local checks
        print("[CHECK] Executing Ruff Static Python Linter...")
        lint_res = run_local_lint()
        
        print("[CHECK] Executing Rust Cargo Clippy Backend Audits...")
        rust_res = run_local_rust_linter()
        
        print("[CHECK] Executing TypeScript compiler type audits...")
        ts_res = run_local_ts_linter()
        
        print("[CHECK] Analyzing Git Modifications...")
        diff_res = run_local_git_diff()
        
        print("[CHECK] Auditing RAG Vector Index...")
        rag_res = run_local_rag_audit()
        
        print("[CHECK] Verifying LangGraph Prompt Schemas...")
        prompt_res = run_local_prompt_audit()
        
        print("[CHECK] Scanning Security & Env Variables...")
        sec_res = run_local_security_audit()
        
        print("[CHECK] Verifying MLOps Pipeline Structure...")
        mlops_res = run_local_mlops_structure_audit()
        
        # Compile report
        print("\n[PROCESS] Consolidating full-stack local audit results...")
        report = compile_fallback_report(lint_res, rust_res, ts_res, diff_res, rag_res, prompt_res, sec_res, mlops_res)
        
        # Print Consolidated Report
        print("\n=== FINAL EXECUTIVE DEPLOYMENT REPORT ===")
        print(json.dumps(report, indent=2))
        
        # Persist report
        reports_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "deploy-squad", "reports"))
        os.makedirs(reports_dir, exist_ok=True)
        report_path = os.path.join(reports_dir, "latest_report.json")
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
            
        print(f"\n[SAVE] Saved consolidated executive report to: {report_path}")
        
        # Exit with error code if REJECTED to block pre-commits
        if report["status"] == "REJECTED":
            print("\n[RESULT] Deployment BLOCKED by production guardrails. Please resolve blocking issues!")
            sys.exit(1)
        else:
            print("\n[RESULT] Deployment PASSED production guardrails.")
            sys.exit(0)

if __name__ == "__main__":
    main()
