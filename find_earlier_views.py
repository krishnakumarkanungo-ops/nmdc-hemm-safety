import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        # Search for tool calls viewing or writing index.html around step 1100-1160
        if '"step_index":1140' in line or '"step_index":1130' in line or '"step_index":1110' in line or '"step_index":1080' in line:
            data = json.loads(line)
            step = data.get("step_index")
            calls = data.get("tool_calls", [])
            for c in calls:
                args = c.get("args", {})
                if "index.html" in str(args):
                    print(f"Step {step}: {c.get('name')}, args={args}")
