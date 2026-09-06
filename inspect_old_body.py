import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if '"step_index":1204' in line:
            # Let's inspect what was in step 1204 or find surrounding structure
            data = json.loads(line)
            print("Step 1204 found")
            
# Let's look for how body and main were defined around step 1150-1200
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if 'class="flex-1 flex flex-col' in line and '<body' in line:
            p = line.find('<body')
            print("Body definition:", line[p:p+300])
            break
