import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index")
        if 1150 <= step <= 1180:
            calls = data.get("tool_calls", [])
            for c in calls:
                args = c.get("args", {})
                if "index.html" in str(args.get("TargetFile")):
                    instruction = args.get("Instruction", "")
                    content = args.get("ReplacementContent", "") or args.get("CodeContent", "")
                    print(f"Step {step}: {instruction}")
                    if "aside" in content or "sidebar" in content:
                        print("Content length:", len(content))
                        print("Sample:\n", content[:500])
