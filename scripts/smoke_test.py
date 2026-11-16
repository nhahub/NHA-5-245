"""Test the split SLA Guard webhook and optionally exercise the local demo site."""
import argparse
from datetime import datetime, timezone
from getpass import getpass
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def call(url, payload, key=None):
    headers = {"Content-Type": "application/json"}
    if key is not None:
        headers["X-SLA-Key"] = key
    req = Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urlopen(req, timeout=95) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        raw = error.read().decode()
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw": raw[:500]}
        return error.code, body


def expect(url, payload, key, status):
    actual, body = call(url, payload, key)
    assert actual == status, f"{payload}: expected HTTP {status}, got {actual}: {body}"
    assert body.get("ok") is (status == 200) and body.get("execution_id"), body
    print(f"PASS: {json.dumps(payload)} -> HTTP {status}")
    return body.get("result") if status == 200 else body


def set_demo_state(base_url, token, state):
    req = Request(base_url + "/admin/" + state,
                  headers={"Authorization": "Bearer " + token}, method="POST")
    with urlopen(req, timeout=10) as response:
        assert json.load(response)["status"] == state


def check_site(url, key, expected_status):
    check = expect(url, {"action": "check"}, key, 200)["check"]
    assert check["is_up"] is (expected_status == 200), check
    assert check["status_code"] == expected_status and check["source"] == "live", check


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8080/webhook/sla-guard")
    parser.add_argument("--local-env", action="store_true", help="read project keys from .env")
    parser.add_argument("--demo", action="store_true", help="validate the seeded synthetic month")
    parser.add_argument("--outage", action="store_true", help="toggle the local demo down and restore it")
    args = parser.parse_args()
    secrets = {}
    if args.local_env:
        path = Path(__file__).resolve().parents[1] / ".env"
        secrets = dict(line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines()
                       if line and not line.startswith("#"))
    key = os.environ.get("SLA_WEBHOOK_KEY") or secrets.get("SLA_WEBHOOK_KEY") or getpass("X-SLA-Key (hidden): ")
    if args.outage and not secrets.get("DEMO_CONTROL_TOKEN"):
        parser.error("--outage requires --local-env and the demo control token")

    status, _ = call(args.url, {"action": "status"})
    assert status in (401, 403), f"Unauthenticated request must be rejected, received {status}"
    print("PASS: missing key rejected")
    for payload in ({"action": "invalid"}, {"action": "report", "month": "2026-13"},
                    {"action": "check", "dataset": "demo"}, {"action": "get_report"}):
        assert expect(args.url, payload, key, 400)["code"] == "INVALID_REQUEST"
    missing = {"action": "get_report", "month": "1970-01", "dataset": "demo"}
    assert expect(args.url, missing, key, 404)["code"] == "REPORT_NOT_FOUND"

    if args.outage:
        demo_url = "http://localhost:" + secrets.get("LOCAL_DEMO_PORT", "8082")
        control_token = secrets["DEMO_CONTROL_TOKEN"]
        set_demo_state(demo_url, control_token, "up")
        try:
            check_site(args.url, key, 200)
            set_demo_state(demo_url, control_token, "down")
            check_site(args.url, key, 503)
        finally:
            set_demo_state(demo_url, control_token, "up")
        check_site(args.url, key, 200)
        print("PASS: healthy check, observed HTTP 503, and recovery")
    else:
        check = expect(args.url, {"action": "check"}, key, 200)["check"]
        assert check["source"] == "live" and isinstance(check["is_up"], bool), check

    status = expect(args.url, {"action": "status"}, key, 200)
    assert status["dataset"] == "live" and status["current_status"] in {"up", "down", "unknown"}
    assert isinstance(status["recent_checks"], list)

    current = datetime.now(timezone.utc).strftime("%Y-%m")
    provisional = expect(args.url, {"action": "report", "month": current}, key, 200)
    assert provisional["report"]["is_final"] is False and provisional["claim_draft"] is None
    assert provisional["report"]["candidate_credit_amount"] == 0
    saved = expect(args.url, {"action": "get_report", "month": current}, key, 200)
    assert saved["report_id"] == provisional["report_id"] and saved["revision"] == provisional["revision"]
    assert saved["claim_draft"] is None

    if args.demo:
        status = expect(args.url, {"action": "status", "dataset": "demo"}, key, 200)
        assert status["current_status"] == "unknown" and status["latest_check"] is not None
        report = expect(args.url, {"action": "report", "dataset": "demo"}, key, 200)
        assert report["report"]["assessment"] == "breach_detected"
        assert report["report"]["down_seconds"] == 7200 and report["report"]["candidate_credit_amount"] == 10
        assert report["claim_draft"].splitlines()[:2] == [
            "SLA GUARD CLAIM DRAFT", "DEMO ONLY - SYNTHETIC EVIDENCE",
        ]
        saved = expect(args.url, {"action": "get_report", "month": report["report"]["month"], "dataset": "demo"}, key, 200)
        for field in ("report_id", "revision", "report", "claim_draft"):
            assert saved[field] == report[field], field
        print("PASS: 120-minute synthetic outage, USD 10 candidate credit, and same saved revision and draft")
    print("SLA Guard smoke test passed.")


if __name__ == "__main__":
    main()
