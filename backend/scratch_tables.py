import sqlite3

conn = sqlite3.connect(r'd:\New folder\org-insight\backend\org_insight.db')
cursor = conn.cursor()
tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables in SQLite DB:")
for t in sorted(tables):
    print(" ", t)
