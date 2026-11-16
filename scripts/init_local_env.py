"""Generate deployment-specific secrets once for the local SLA Guard stack."""
from base64 import urlsafe_b64encode
from hashlib import sha256
from hmac import new
import json
from pathlib import Path
from secrets import token_hex


def encode(value):
    return urlsafe_b64encode(value).rstrip(b"=")


def service_token(secret):
    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    claims = encode(json.dumps({"role": "service_role"}).encode())
    signing_input = header + b"." + claims
    signature = encode(new(secret.encode(), signing_input, sha256).digest())
    return (signing_input + b"." + signature).decode()


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[1] / ".env"
    jwt_secret = token_hex(32)
    settings = {
        "LOCAL_DEMO_PORT": "8082",
        "DEMO_CONTROL_TOKEN": token_hex(32),
        "SLA_DB_PASSWORD": token_hex(32),
        "SLA_DATA_DB_PASSWORD": token_hex(32),
        "SLA_DATA_JWT_SECRET": jwt_secret,
        "SLA_LOCAL_API_JWT": service_token(jwt_secret),
        "SLA_WEBHOOK_KEY": token_hex(32),
    }
    try:
        with path.open("x", encoding="utf-8") as env_file:
            env_file.writelines(f"{key}={value}\n" for key, value in settings.items())
    except FileExistsError:
        print(".env already exists. Existing settings were kept.")
    else:
        print("Created .env with local SLA Guard credentials.")
