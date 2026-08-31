with open('frontend/src/app/dashboard/custom-reports/[id]/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()
for i in range(514, 537):
    print(f"{i+1}: {repr(lines[i])}")
