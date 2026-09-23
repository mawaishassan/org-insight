import sqlite3

db_path = r'd:\New folder\org-insight\backend\org_insight.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get row 1655397
res = cursor.execute("SELECT * FROM kpi_multi_line_cells WHERE row_id = 1655397").fetchall()
print(f"Cells for row 1655397 (count={len(res)}):")
for r in res:
    print(f"  sub_field_id={r[2]}, value_text={r[3]}, value_number={r[4]}, value_boolean={r[5]}")

print("\nSearch for numbers between 82.8 and 82.9 or 84.4 and 84.5 in kpi_multi_line_cells:")
res2 = cursor.execute("SELECT * FROM kpi_multi_line_cells WHERE (value_number >= 82.8 AND value_number <= 82.9) OR (value_number >= 84.4 AND value_number <= 84.5)").fetchall()
for r in res2:
    print(f"  cell_id={r[0]}, row_id={r[1]}, sub_field_id={r[2]}, val_num={r[4]}")
