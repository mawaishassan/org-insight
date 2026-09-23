import os

with open(r'd:\New folder\org-insight\backend\app\reports\custom_service.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "selected_columns" in line or "filter" in line.lower() or "kfield" in line:
        if "multi_line_items" in line or "selected_columns" in line:
            print(f"Line {idx+1}: {line.strip()}")
