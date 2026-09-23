with open(r'd:\New folder\org-insight\backend\app\reports\custom_service.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx in range(614, min(1400, len(lines))):
    line = lines[idx]
    if "filter" in line.lower() or "condition" in line.lower() or "where" in line.lower() or "eval" in line.lower():
        print(f"Line {idx+1}: {line.strip()}")
