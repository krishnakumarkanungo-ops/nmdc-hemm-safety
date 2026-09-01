"""
Automatic Git Commit & Sync Utility
Pushes latest project code to GitHub repository for automated 24/7 cloud deployments.
"""

import os
import sys
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

def sync(message="Automated update from prompt"):
    print(f"[*] Staging and committing changes: '{message}'...")
    
    # Try standard git first if available
    git_bin = "git"
    try:
        subprocess.run([git_bin, "add", "."], cwd=str(BASE_DIR), check=True)
        subprocess.run([git_bin, "commit", "-m", message], cwd=str(BASE_DIR))
        print("[*] Pushing to GitHub (origin main)...")
        res = subprocess.run([git_bin, "push", "origin", "main"], cwd=str(BASE_DIR))
        if res.returncode == 0:
            print("[+] Successfully pushed changes to GitHub!")
            return True
    except Exception as e:
        pass

    # Fallback to Dulwich pure-python git
    try:
        import dulwich.porcelain as git
        repo = git.open_repo(str(BASE_DIR))
        git.add(repo, paths=["."])
        try:
            git.commit(repo, message=message.encode("utf-8"), author=b"Krishna Kumar <krishnakumarkanungo-ops@users.noreply.github.com>")
            print("[+] Local commit created via Dulwich.")
        except Exception as ce:
            print(f"[*] Commit note: {ce}")

        # Check if remote exists
        config = repo.get_config()
        # Attempt push
        remote_url = "https://github.com/krishnakumarkanungo-ops/nmdc-hemm-safety.git"
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            remote_url = f"https://{token}@github.com/krishnakumarkanungo-ops/nmdc-hemm-safety.git"
            git.push(repo, remote_url, refspecs=[b"refs/heads/main"])
            print("[+] Successfully pushed to GitHub via Dulwich!")
            return True
        else:
            print("[!] Note: Set GITHUB_TOKEN environment variable or authenticate git to push automatically.")
    except Exception as de:
        print(f"[!] Dulwich sync info: {de}")

    return False

if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else "Update HEMM CAS application"
    sync(msg)
