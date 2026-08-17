import os
import sys

def search_file(filepath, pattern):
    print(f"Searching for '{pattern}' in '{filepath}'...")
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return
    with open(filepath, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f, 1):
            if pattern.lower() in line.lower():
                print(f"{idx}: {line.strip()}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        search_file(sys.argv[1], sys.argv[2])
    else:
        print("Usage: python search_helper.py <file_path> <pattern>")
