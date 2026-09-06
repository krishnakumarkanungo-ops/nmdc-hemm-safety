with open(r"C:\Users\Krishna Kumar\.gemini\antigravity\scratch\hemm_safety_system\frontend\js\app.js", "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if "switchView" in line:
            print(f"Line {i+1}: {line.strip()}")
