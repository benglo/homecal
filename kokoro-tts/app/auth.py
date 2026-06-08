"""X-Pi-Token verification dependency. Compares against the same token the
Pi voice service uses (PI_API_TOKEN env). Returns 401 on missing/wrong;
never echoes the expected token in the error body."""
from fastapi import Header, HTTPException, status
from app.config import from_env


async def require_pi_token(x_pi_token: str | None = Header(default=None)):
    expected = from_env().pi_api_token
    if not x_pi_token or x_pi_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing X-Pi-Token",
        )
