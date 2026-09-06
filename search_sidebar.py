import os
import json

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
if os.path.exists(transcript_path):
    with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
        matches = []
        for line_num, line in enumerate(f):
            if any(k in line.lower() for k in ["sidebar", "<aside", "side-nav", "sidebar-"]):
                matches.append((line_num, line[:400]))
                
        print(f"Found {len(matches)} matches")
        for num, m in matches[-15:]:
            print(f"Line {num}: {m.encode('ascii', 'replace').decode('ascii')}\n")
