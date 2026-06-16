import subprocess
import os

def run_linter(file_path: str = None) -> str:
    """
    Executes static analysis/linting checks based on target codebase.
    - Python (src-python/): runs Ruff
    - Frontend TS/React (src/): runs npx tsc --noEmit
    - Rust backend (src-tauri/): runs cargo clippy --all-targets -- -D warnings
    """
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    
    if file_path:
        abs_path = os.path.abspath(os.path.join(project_root, file_path))
    else:
        abs_path = project_root
        
    results = []
    
    # 1. Python checks
    python_dir = os.path.join(project_root, "src-python")
    if "src-python" in abs_path or abs_path == project_root:
        try:
            res = subprocess.run(
                ["ruff", "check", python_dir], 
                capture_output=True, 
                text=True, 
                check=False
            )
            python_lint = res.stdout if res.stdout else "No linting issues found in Python."
            results.append(f"=== Ruff Python Linter ===\n{python_lint}")
        except Exception as e:
            results.append(f"=== Ruff Python Linter (FAILED) ===\n{str(e)}")
            
    # 2. TypeScript/Frontend checks
    src_dir = os.path.join(project_root, "src")
    if "src" in abs_path or abs_path == project_root:
        try:
            res = subprocess.run(
                ["npx", "tsc", "--noEmit"], 
                cwd=project_root,
                shell=True,
                capture_output=True, 
                text=True, 
                check=False
            )
            ts_lint = res.stdout if res.stdout else "No type/linting issues found in TypeScript/React."
            results.append(f"=== TypeScript compiler ===\n{ts_lint}")
        except Exception as e:
            results.append(f"=== TypeScript compiler (FAILED) ===\n{str(e)}")
            
    # 3. Rust backend checks
    rust_dir = os.path.join(project_root, "src-tauri")
    if "src-tauri" in abs_path or abs_path == project_root:
        try:
            res = subprocess.run(
                ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], 
                cwd=rust_dir,
                shell=True,
                capture_output=True, 
                text=True, 
                check=False
            )
            clippy_lint = res.stderr if res.stderr and "error" in res.stderr.lower() else "No warnings or errors found in Rust backend."
            results.append(f"=== Rust cargo clippy ===\n{clippy_lint}")
        except Exception as e:
            results.append(f"=== Rust cargo clippy (FAILED) ===\n{str(e)}")
            
    return "\n\n".join(results)

def get_git_diff(repo_path: str = None) -> str:
    """
    Retrieves the current uncommitted git modifications to evaluate new code changes.
    """
    try:
        if not repo_path:
            repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
            
        result = subprocess.run(
            ["git", "diff", "HEAD"], 
            cwd=repo_path, 
            capture_output=True, 
            text=True, 
            check=True
        )
        return result.stdout if result.stdout else "No changes detected in Git repository."
    except Exception as e:
        return f"Failed to read git diff: {str(e)}"