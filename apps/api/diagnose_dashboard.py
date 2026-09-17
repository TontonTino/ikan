import urllib.request
import urllib.parse
import json
import http.cookiejar

base_url = "https://ikanai-api.onrender.com/api/v1"

def test_login_and_feedbacks(email, password, label):
    print(f"\n==========================================")
    print(f" TEST UTILISATEUR : {label} ({email})")
    print(f"==========================================")
    
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    
    # 1. Login
    login_url = f"{base_url}/auth/login"
    payload = json.dumps({"email": email, "mot_de_passe": password}).encode('utf-8')
    req = urllib.request.Request(login_url, data=payload, headers={"Content-Type": "application/json"})
    
    try:
        res = opener.open(req)
        print(f"[LOGIN STATUS]: {res.status}")
        user_data = json.loads(res.read().decode())
        print(f"[USER LOGGED IN]: ID={user_data.get('id')}, Role={user_data.get('role')}, OrgID={user_data.get('organisation_id')}")
    except Exception as e:
        print(f"[LOGIN FAILED]: {e}")
        return

    # 2. GET /feedbacks/
    fb_url = f"{base_url}/feedbacks/?limit=200"
    req_fb = urllib.request.Request(fb_url)
    try:
        res_fb = opener.open(req_fb)
        print(f"[GET /feedbacks STATUS]: {res_fb.status}")
        fbs = json.loads(res_fb.read().decode())
        print(f"[FEEDBACKS COUNT]: {len(fbs)}")
        if len(fbs) > 0:
            print(f"[SAMPLE FEEDBACK 0]: Note={fbs[0].get('note')}, Agence={fbs[0].get('agence_nom')}, Commentaire={fbs[0].get('commentaire')[:40]}...")
    except urllib.error.HTTPError as e:
        print(f"[GET /feedbacks HTTP ERROR {e.code}]: {e.read().decode()}")
    except Exception as e:
        print(f"[GET /feedbacks FAILED]: {e}")

    # 3. GET /dashboard/siege
    siege_url = f"{base_url}/dashboard/siege"
    req_siege = urllib.request.Request(siege_url)
    try:
        res_siege = opener.open(req_siege)
        print(f"[GET /dashboard/siege STATUS]: {res_siege.status}")
        s_data = json.loads(res_siege.read().decode())
        print(f"[SIEGE DASHBOARD DATA]: Total Feedbacks={s_data.get('kpis', {}).get('total_feedbacks')}")
    except urllib.error.HTTPError as e:
        print(f"[GET /dashboard/siege HTTP ERROR {e.code}]: {e.read().decode()}")
    except Exception as e:
        print(f"[GET /dashboard/siege FAILED]: {e}")

test_login_and_feedbacks("cx@orange.tn", "Password123!", "CX MANAGER")
test_login_and_feedbacks("admin@ikanai.app", "Password123!", "ADMINISTRATEUR")
