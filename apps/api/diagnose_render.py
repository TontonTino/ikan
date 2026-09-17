import urllib.request
import urllib.error
import json

base_api = "https://ikanai-api.onrender.com"
test_origin = "https://ad-julian.trycloudflare.com"

print("==================================================")
print("     ANALYSE DIAGNOSTIQUE COMPLÈTE RENDER API      ")
print("==================================================")

# 1. TEST HEALTH
print("\n--- 1. TEST HEALTH CHECK ---")
try:
    req = urllib.request.Request(f"{base_api}/health")
    with urllib.request.urlopen(req) as res:
        print(f"HTTP Status: {res.status}")
        print(f"Response: {res.read().decode()}")
except Exception as e:
    print(f"FAILED: {e}")

# 2. TEST CORS PREFLIGHT (OPTIONS)
print("\n--- 2. TEST CORS PREFLIGHT (OPTIONS) DEPUIS CLOUDFLARE ---")
try:
    req = urllib.request.Request(
        f"{base_api}/api/v1/feedbacks/?qr_code=QR-ORANGE-TUNIS-01",
        method="OPTIONS",
        headers={
            "Origin": test_origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        }
    )
    with urllib.request.urlopen(req) as res:
        print(f"HTTP Status: {res.status}")
        print("CORS Headers:")
        for k, v in res.headers.items():
            if "access-control" in k.lower():
                print(f"  {k}: {v}")
except urllib.error.HTTPError as e:
    print(f"HTTP Error {e.code}: {e.read().decode()}")
    for k, v in e.headers.items():
        if "access-control" in k.lower():
            print(f"  {k}: {v}")
except Exception as e:
    print(f"FAILED: {e}")

# 3. TEST VALIDATE QR CODE
print("\n--- 3. TEST VALIDATE QR CODE (/qr-codes/QR-ORANGE-TUNIS-01/validate) ---")
try:
    req = urllib.request.Request(
        f"{base_api}/api/v1/qr-codes/QR-ORANGE-TUNIS-01/validate",
        headers={"Origin": test_origin}
    )
    with urllib.request.urlopen(req) as res:
        print(f"HTTP Status: {res.status}")
        print(f"Response Body: {res.read().decode()}")
        print(f"Access-Control-Allow-Origin: {res.headers.get('Access-Control-Allow-Origin')}")
except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.read().decode()}")
except Exception as e:
    print(f"FAILED: {e}")

# 4. TEST POST FEEDBACK
print("\n--- 4. TEST POST SUBMIT FEEDBACK ---")
try:
    payload = json.dumps({"note": 4, "commentaire": "Test diagnostic live"}).encode('utf-8')
    req = urllib.request.Request(
        f"{base_api}/api/v1/feedbacks/?qr_code=QR-ORANGE-TUNIS-01",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Origin": test_origin
        }
    )
    with urllib.request.urlopen(req) as res:
        print(f"HTTP Status: {res.status}")
        print(f"Response Body: {res.read().decode()}")
        print(f"Access-Control-Allow-Origin: {res.headers.get('Access-Control-Allow-Origin')}")
except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.read().decode()}")
except Exception as e:
    print(f"FAILED: {e}")
