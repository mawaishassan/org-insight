import sqlite3
import os

db_path = r'd:\New folder\org-insight\backend\org_insight.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Searching DB for 82.85 or 84.45...")

tables = cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
for t in tables:
    table_name = t[0]
    cols = [c[1] for c in cursor.execute(f"PRAGMA table_info('{table_name}');").fetchall()]
    for col in cols:
        try:
            query = f"SELECT * FROM '{table_name}' WHERE CAST('{col}' AS TEXT) LIKE '%82.85%' OR CAST('{col}' AS TEXT) LIKE '%84.45%';"
            # Fix column SQL injection: use proper column escaping
            query = f"SELECT * FROM \"{table_name}\" WHERE CAST(\"{col}\" AS TEXT) LIKE '%82.85%' OR CAST(\"{col}\" AS TEXT) LIKE '%84.45%';"
            res = cursor.execute(query).fetchall()
            if res:
                print(f"MATCH IN table '{table_name}', col '{col}': count={len(res)}")
                for row in res[:3]:
                    print(f"   {row}")
        except Exception as e:
            pass
