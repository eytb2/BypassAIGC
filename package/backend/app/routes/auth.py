import logging
import re
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.models import EmailVerificationCode, User
from app.schemas import (
    SendCodeRequest,
    SendCodeResponse,
    VerifyCodeRequest,
    VerifyCodeResponse,
)
from app.services.email_service import (
    is_smtp_configured,
    send_card_key_email,
    send_verification_code_email,
)
from app.utils.auth import generate_access_link, generate_card_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


@router.post("/send-code", response_model=SendCodeResponse)
async def send_verification_code(
    data: SendCodeRequest, db: Session = Depends(get_db)
) -> SendCodeResponse:
    """
    发送邮箱验证码
    """
    email = data.email.strip().lower()
    if not email or not EMAIL_REGEX.match(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="请输入有效的邮箱地址"
        )

    # 频率检查: 冷却时间内不允许重复获取验证码
    now = datetime.utcnow()
    recent_code = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.email == email)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    if recent_code:
        elapsed = (now - recent_code.created_at).total_seconds()
        if elapsed < settings.EMAIL_COOLDOWN_SECONDS:
            remaining = int(settings.EMAIL_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"请求过于频繁，请等待 {remaining} 秒后再获取验证码",
            )

    # 生成 6 位随机纯数字验证码
    code = f"{secrets.randbelow(900000) + 100000:06d}"
    expires_at = now + timedelta(minutes=settings.EMAIL_VERIFY_EXPIRE_MINUTES)

    record = EmailVerificationCode(
        email=email,
        code=code,
        expires_at=expires_at,
        is_used=False,
    )
    db.add(record)
    db.commit()

    # 发送验证码邮件
    sent_success, msg = send_verification_code_email(email, code)
    if not sent_success and is_smtp_configured():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"验证码邮件发送失败: {msg}，请联系管理员",
        )

    response_msg = "验证码已发送至您的邮箱，请注意查收"
    debug_code = None
    if not is_smtp_configured():
        response_msg = f"验证码已生成（后台SMTP未配置完整，测试验证码: {code}）"
        debug_code = code

    return SendCodeResponse(
        success=True,
        message=response_msg,
        remaining_seconds=settings.EMAIL_COOLDOWN_SECONDS,
        debug_code=debug_code,
    )


@router.post("/verify-code", response_model=VerifyCodeResponse)
async def verify_code_and_get_card(
    data: VerifyCodeRequest, db: Session = Depends(get_db)
) -> VerifyCodeResponse:
    """
    校验邮箱验证码，并自动生成或获取专属卡密，同时将卡密通过邮件发送至用户邮箱
    """
    email = data.email.strip().lower()
    code = data.code.strip()

    if not email or not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="邮箱和验证码不能为空"
        )

    now = datetime.utcnow()
    # 查询匹配且未使用的有效验证码
    record = (
        db.query(EmailVerificationCode)
        .filter(
            EmailVerificationCode.email == email,
            EmailVerificationCode.code == code,
            EmailVerificationCode.is_used.is_(False),
            EmailVerificationCode.expires_at > now,
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )

    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="验证码错误或已过期，请重新获取"
        )

    # 标记验证码已使用
    record.is_used = True

    # 检查该邮箱是否已有对应的 User 记录
    user = db.query(User).filter(User.email == email).first()
    is_new = False

    if not user:
        # 新用户：生成专属卡密
        is_new = True
        card_key = generate_card_key(length=12, prefix="AIGC")
        # 确保卡密唯一
        while db.query(User).filter(User.card_key == card_key).first():
            card_key = generate_card_key(length=12, prefix="AIGC")

        access_link = generate_access_link(card_key)
        user = User(
            card_key=card_key,
            access_link=access_link,
            email=email,
            is_active=True,
            usage_limit=settings.DEFAULT_CARD_USAGE_LIMIT,
            usage_count=0,
        )
        db.add(user)
    else:
        # 已有用户：确保激活
        if not user.is_active:
            user.is_active = True

    db.commit()
    db.refresh(user)

    # 将卡密通过邮件异步或同步发送给用户
    try:
        send_card_key_email(email, user.card_key)
    except Exception as e:
        logger.error(f"发送卡密邮件至 {email} 失败: {e}")

    return VerifyCodeResponse(
        success=True,
        card_key=user.card_key,
        is_new=is_new,
        message="验证通过！卡密已发送至您的邮箱，并已为您自动填入",
    )
