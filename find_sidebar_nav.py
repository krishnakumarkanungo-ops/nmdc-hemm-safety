import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if 'btn-role-nav' in line and 'main-sidebar' in line:
            # Let's extract the snippet
            idx = line.find('<aside id=\\"main-sidebar\\"')
            if idx == -1:
                idx = line.find('<aside id="main-sidebar"')
            if idx != -1:
                end_idx = line.find('</aside>', idx)
                if end_idx != -1:
                    print("Found complete sidebar in transcript line:")
                    snippet = line[idx:end_idx+len('</aside>')]
                    # unescape if needed
                    snippet = snippet.replace('\\"', '"').replace('\\n', '\n').replace('\\/', '/')
                    with open("extracted_sidebar.html", "w", encoding="utf-8") as f_out:
                        f_out.write(snippet)
                    print(f"Saved extracted_sidebar.html, length: {len(snippet)}")
                    break
