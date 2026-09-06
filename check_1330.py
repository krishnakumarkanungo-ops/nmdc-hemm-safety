import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index", 0)
        if 1330 <= step <= 1345:
            print(f"Step {step}: type={data.get('type')}")
            for c in data.get("tool_calls", []):
                print(f"  Tool: {c.get('name')} target: {c.get('args', {}).get('TargetFile') or c.get('args', {}).get('AbsolutePath')}")
                if c.get("name") == "view_file":
                    print("  view_file args:", c.get("args"))
