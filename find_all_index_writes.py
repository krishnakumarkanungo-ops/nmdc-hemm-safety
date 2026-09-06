import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if 'TargetFile' in line and 'index.html' in line:
            data = json.loads(line)
            step = data.get("step_index")
            for c in data.get("tool_calls", []):
                args = c.get("args", {})
                if "write_to_file" == c.get("name") and "index.html" in str(args.get("TargetFile")):
                    print(f"Step {step}: write_to_file index.html")
