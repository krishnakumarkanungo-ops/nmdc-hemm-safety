import shutil
import os
import subprocess

git_path = shutil.which("git")
if not git_path:
    candidates = [
        r"C:\Program Files\Git\bin\git.exe",
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Users\Krishna Kumar\AppData\Local\Programs\Git\cmd\git.exe"
    ]
    for c in candidates:
        if os.path.exists(c):
            git_path = c
            break

print("Git found at:", git_path)
if git_path:
    # Run git log
    res = subprocess.run([git_path, "log", "-n", "8", "--oneline"], capture_output=True, text=True)
    print("Git log:\n", res.stdout)
    
    # Show index.html from 2 commits ago
    res2 = subprocess.run([git_path, "show", "HEAD~2:frontend/index.html"], capture_output=True, text=True)
    if res2.returncode == 0:
        with open("old_index.html", "w", encoding="utf-8") as f:
            f.write(res2.stdout)
        print("Saved old_index.html, length:", len(res2.stdout))
    else:
        print("Git show failed:", res2.stderr)
