import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        if data.get("step_index") == 1155:
            for c in data.get("tool_calls", []):
                print("TargetContent:")
                print(c.get("args", {}).get("TargetContent"))
                print("---")
                print("ReplacementContent:")
                print(c.get("args", {}).get("ReplacementContent"))
