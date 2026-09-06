import os
import json

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index", 0)
        # Check around step 1100 to 1210
        if 1150 <= step <= 1220 and data.get("type") == "PLANNER_RESPONSE":
            calls = data.get("tool_calls", [])
            for c in calls:
                if c.get("name") in ["replace_file_content", "write_to_file"]:
                    args = c.get("args", {})
                    target = args.get("TargetFile", "")
                    if "index.html" in target or "styles.css" in target:
                        print(f"Step {step}: tool {c.get('name')}, file: {target}")
                        content = args.get("CodeContent") or args.get("ReplacementContent") or ""
                        if "<aside" in content or "sidebar" in content:
                            print("Found sidebar in content:", content[:300])

