import urllib.request
import urllib.error
import json

base_url = "https://ikanai-api.onrender.com/api/v1"
req = urllib.request.Request(
    f"{base_url}/auth/login",
    data=json.dumps({"email": "cx@orange.tn", "mot_de_passe": "Password123!"}).encode('utf-8'),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as res:
        print("SUCCESS:", res.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error Code:", e.code)
    print("Error Body:", e.read().decode())
