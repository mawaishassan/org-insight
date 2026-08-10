import urllib.request
import urllib.error

def main():
    urls = [
        "http://localhost:8080/",
        "http://localhost:8080/docs",
        "http://localhost:8080/api/v1/health" # standard healthcheck if exists
    ]
    for url in urls:
        print(f"Testing URL: {url}")
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                print(f"  Status: {resp.status}")
                print(f"  Headers: {resp.info().as_string()[:200]}")
        except urllib.error.URLError as e:
            print(f"  Error: {e}")
        except Exception as e:
            print(f"  Unexpected Exception: {e}")
        print("-" * 50)

if __name__ == "__main__":
    main()
