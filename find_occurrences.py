import os

filepath = "static/app.js"
if os.path.exists(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()
    for idx, line in enumerate(lines):
        if "loadTables" in line and "function" in line:
            print(f"Line {idx+1}: {line.strip()}")
else:
    print("File not found")
