import sys
sys.stdout.reconfigure(encoding='utf-8')

with open("../frontend/src/app/dashboard/custom-reports/[id]/design/page.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()
    for idx in range(3125, 3161):
        print(f"Line {idx}: {repr(lines[idx-1])}")
