import random
import uuid
from datetime import datetime, timedelta
import logging
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.core.models import CaptchaChallenge

logger = logging.getLogger(__name__)

def generate_random_challenge() -> tuple[str, str]:
    """
    Generate a random question and its answer.
    Returns (question, answer)
    """
    challenge_type = random.choice(["add", "sub"])
    if challenge_type == "add":
        x = random.randint(1, 20)
        y = random.randint(1, 20)
        return f"{x} + {y}", str(x + y)
    else:  # sub
        x = random.randint(10, 30)
        y = random.randint(1, 9)
        return f"{x} - {y}", str(x - y)


async def create_captcha_challenge(db: AsyncSession) -> dict:
    """
    Generate a new CAPTCHA challenge, store it in DB, and return it.
    Also cleans up expired challenges.
    """
    now = datetime.utcnow()
    # Organic cleanup of expired challenges
    try:
        await db.execute(delete(CaptchaChallenge).where(CaptchaChallenge.expires_at < now))
    except Exception as e:
        logger.warning(f"Error cleaning up expired CAPTCHAs: {e}")

    question, answer = generate_random_challenge()
    challenge_id = str(uuid.uuid4())
    expires_at = now + timedelta(minutes=5)

    challenge = CaptchaChallenge(
        id=challenge_id,
        question=question,
        answer=answer,
        expires_at=expires_at,
        attempts=0
    )
    db.add(challenge)
    await db.flush()

    return {"captcha_id": challenge_id, "question": question}


async def verify_and_consume_captcha(
    db: AsyncSession,
    captcha_id: str,
    user_answer: str,
    username: str,
    remote_ip: str = "unknown"
) -> None:
    """
    Verify the user's captcha answer and delete/consume the challenge on success/failure.
    """
    if not captcha_id:
        logger.warning(f"Failed verification for user '{username}' from {remote_ip}: Missing captcha_id.")
        raise HTTPException(status_code=400, detail="Verification challenge ID is required.")

    if not user_answer:
        logger.warning(f"Failed verification for user '{username}' from {remote_ip}: Missing user_answer.")
        raise HTTPException(status_code=400, detail="Verification answer is required.")

    res = await db.execute(select(CaptchaChallenge).where(CaptchaChallenge.id == captcha_id))
    challenge = res.scalar_one_or_none()

    if not challenge:
        logger.warning(f"Failed verification for user '{username}' from {remote_ip}: challenge ID '{captcha_id}' not found.")
        raise HTTPException(status_code=400, detail="Verification challenge not found or expired. Please refresh challenge.")

    now = datetime.utcnow()
    if now > challenge.expires_at:
        await db.delete(challenge)
        await db.commit()
        logger.warning(f"Failed verification for user '{username}' from {remote_ip}: challenge ID '{captcha_id}' has expired.")
        raise HTTPException(status_code=400, detail="Verification challenge has expired. Please refresh challenge.")

    if challenge.attempts >= 3:
        await db.delete(challenge)
        await db.commit()
        logger.warning(f"Failed verification for user '{username}' from {remote_ip}: challenge ID '{captcha_id}' exceeded max attempts.")
        raise HTTPException(status_code=400, detail="Verification challenge expired. Please refresh challenge.")

    # Match normalization
    expected = challenge.answer.strip()
    actual = user_answer.strip()

    matched = (actual.lower() == expected.lower())

    if not matched:
        challenge.attempts += 1
        await db.commit()
        logger.warning(
            f"Failed verification for user '{username}' from {remote_ip}: "
            f"incorrect answer '{user_answer}' (expected '{challenge.answer}'). Attempts: {challenge.attempts}"
        )
        if challenge.attempts >= 3:
            await db.delete(challenge)
            await db.commit()
            raise HTTPException(status_code=400, detail="Verification challenge expired. Please refresh challenge.")
        raise HTTPException(status_code=400, detail="Incorrect answer.")

    # Successful match: delete the challenge to prevent replay/reuse
    await db.delete(challenge)
    await db.commit()
    logger.info(f"Successful verification for user '{username}' from {remote_ip}")
