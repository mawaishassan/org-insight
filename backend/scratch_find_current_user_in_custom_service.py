with open(r'd:\New folder\org-insight\backend\app\reports\custom_service.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "current_user" in line:
        print(f"Line {idx+1}: {line.strip()}")
