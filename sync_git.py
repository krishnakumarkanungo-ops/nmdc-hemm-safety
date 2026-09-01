"""
Automatic Git Commit & Sync Utility
Pushes latest project code to GitHub repository for automated 24/7 cloud deployments.
"""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TOKEN = "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"
REPO_URL = f"https://krishnakumarkanungo-ops:{TOKEN}@github.com/krishnakumarkanungo-ops/nmdc-hemm-safety.git"

def sync(message="Automated update from prompt"):
    print(f"[*] Staging and committing changes: '{message}'...")
    try:
        import dulwich.porcelain as git
        repo = git.open_repo(str(BASE_DIR))
        git.add(repo, paths=["."])
        try:
            git.commit(
                repo,
                message=message.encode("utf-8"),
                author=b"krishnakumarkanungo-ops <krishnakumarkanungo-ops@users.noreply.github.com>"
            )
            print("[+] Local commit created.")
        except Exception as ce:
            print(f"[*] Commit note: {ce}")

        print("[*] Pushing to GitHub (origin main)...")
        git.push(repo, REPO_URL, refspecs=[b"refs/heads/main:refs/heads/main"])
        print("[SUCCESS] Successfully pushed updates to https://github.com/krishnakumarkanungo-ops/nmdc-hemm-safety")
        return True
    except Exception as e:
        print(f"[!] Git sync error: {e}")
        return False

if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else "Update HEMM CAS application"
    sync(msg)
