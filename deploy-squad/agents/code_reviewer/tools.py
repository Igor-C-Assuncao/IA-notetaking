import subprocess
import os

def run_linter(file_path: str = None) -> str:
    """
    Executes Ruff static analysis on the specified file or the entire src-python project to detect style violations and bugs.
    """
    try:
        if not file_path:
            # Default to the src-python folder of the current workspace
            file_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "src-python"))
        else:
            if not os.path.isabs(file_path):
                file_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", file_path))
                
        result = subprocess.run(
            ["ruff", "check", file_path], 
            capture_output=True, 
            text=True, 
            check=False
        )
        return result.stdout if result.stdout else "No linting issues found."
    except Exception as e:
        return f"Failed to execute linter execution: {str(e)}"

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