import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if '"step_index":1202' in line or '"step_index":1203' in line or '"step_index":1190' in line or '"step_index":1152' in line:
            data = json.loads(line)
            step = data.get("step_index")
            calls = data.get("tool_calls", [])
            for c in calls:
                if c.get("name") in ["view_file", "replace_file_content"]:
                    args = c.get("args", {})
                    target = args.get("TargetFile") or args.get("AbsolutePath")
                    if "index.html" in str(target):
                        print(f"Step {step}: {c.get('name')}")
                        if "view_file" in c.get("name"):
                            print("view_file args:", args)
                        if "replace_file_content" in c.get("name"):
                            print("Replacement:\n", args.get("ReplacementContent")[:400])
