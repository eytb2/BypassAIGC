import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Tuple

from app.config import settings

logger = logging.getLogger(__name__)


def is_smtp_configured() -> bool:
    """检查 SMTP 配置是否完整"""
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD)


def send_email(to_email: str, subject: str, html_content: str, text_content: str = "") -> Tuple[bool, str]:
    """
    通用邮件发送函数
    返回: (是否成功, 提示或错误原因)
    """
    if not is_smtp_configured():
        logger.warning(
            f"[EMAIL MOCK] SMTP 未配置完整 (HOST={settings.SMTP_HOST}, USER={settings.SMTP_USER}). "
            f"模拟发送至 {to_email}: 标题: {subject}"
        )
        return True, "模拟发送成功（SMTP未配置完整）"

    from_addr = settings.SMTP_FROM or settings.SMTP_USER

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"AI 学术写作助手 <{from_addr}>"
    msg["To"] = to_email

    if text_content:
        part1 = MIMEText(text_content, "plain", "utf-8")
        msg.attach(part1)
    if html_content:
        part2 = MIMEText(html_content, "html", "utf-8")
        msg.attach(part2)

    try:
        # 支持 SSL (通常 465 端口) 或 STARTTLS (通常 587/25 端口)
        if settings.SMTP_USE_SSL or settings.SMTP_PORT == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=context, timeout=12) as server:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(from_addr, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=12) as server:
                server.ehlo()
                if settings.SMTP_USE_TLS or settings.SMTP_PORT == 587:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                    server.ehlo()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(from_addr, [to_email], msg.as_string())

        logger.info(f"邮件已成功发送至 {to_email}, 标题: {subject}")
        return True, "发送成功"
    except Exception as e:
        error_msg = f"邮件发送失败: {str(e)}"
        logger.error(f"发送邮件至 {to_email} 异常: {e}", exc_info=True)
        return False, error_msg


def send_verification_code_email(email: str, code: str) -> Tuple[bool, str]:
    """发送 6 位数邮箱验证码"""
    subject = "【AI写作助手】您的验证码"
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin: 0; padding: 20px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
            <div style="background: linear-gradient(135deg, #2563eb, #3b82f6); padding: 32px 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">AI 学术写作助手</h1>
                <p style="color: #dbeafe; margin: 8px 0 0 0; font-size: 14px;">专业论文润色 · 智能语言优化 · 去 AIGC 降重</p>
            </div>
            <div style="padding: 32px 24px;">
                <p style="font-size: 15px; color: #1e293b; margin-top: 0;">您好！</p>
                <p style="font-size: 15px; color: #334155; line-height: 1.6;">您正在申请获取系统访问卡密，本次验证码为：</p>
                <div style="text-align: center; margin: 28px 0;">
                    <span style="display: inline-block; background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 12px; padding: 14px 36px; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #1d4ed8; font-family: monospace;">
                        {code}
                    </span>
                </div>
                <p style="font-size: 14px; color: #64748b; line-height: 1.6;">
                    验证码有效时间为 <strong>{settings.EMAIL_VERIFY_EXPIRE_MINUTES} 分钟</strong>。请在系统页面输入以完成验证并领取您的专属卡密。<br/>
                    若非您本人操作，请忽略此邮件。
                </p>
                <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
                    此为系统自动发送邮件，请勿直接回复。
                </div>
            </div>
        </div>
    </body>
    </html>
    """
    text_content = (
        f"【AI学术写作助手】您好！您的验证码为：{code}，有效期 {settings.EMAIL_VERIFY_EXPIRE_MINUTES} 分钟。"
        f"请勿泄露给他人。若非本人操作请忽略。"
    )
    return send_email(email, subject, html_content, text_content)


def send_card_key_email(email: str, card_key: str) -> Tuple[bool, str]:
    """发送专属卡密"""
    subject = "【AI写作助手】您的专属访问卡密"
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin: 0; padding: 20px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
            <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 32px 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">AI 学术写作助手</h1>
                <p style="color: #d1fae5; margin: 8px 0 0 0; font-size: 14px;">卡密发放通知</p>
            </div>
            <div style="padding: 32px 24px;">
                <p style="font-size: 15px; color: #1e293b; margin-top: 0;">恭喜您！邮箱验证已通过。</p>
                <p style="font-size: 15px; color: #334155; line-height: 1.6;">您的专属系统访问卡密如下，请妥善保存：</p>
                <div style="text-align: center; margin: 28px 0;">
                    <span style="display: inline-block; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 12px; padding: 14px 28px; font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #15803d; font-family: monospace;">
                        {card_key}
                    </span>
                </div>
                <div style="background: #f8fafc; border-radius: 10px; padding: 16px; margin-top: 20px;">
                    <p style="font-size: 13px; color: #475569; margin: 0; line-height: 1.6;">
                        <strong>使用说明：</strong><br/>
                        1. 打开系统登录页，在卡密输入框中填入该卡密即可直接进入工作台。<br/>
                        2. 该卡密与您的邮箱已绑定，后续若遗忘卡密，可再次输入邮箱验证即可找回。
                    </p>
                </div>
                <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
                    此为系统自动发送邮件，请勿直接回复。
                </div>
            </div>
        </div>
    </body>
    </html>
    """
    text_content = (
        f"【AI学术写作助手】恭喜您！您的专属访问卡密为：{card_key}。"
        f"打开系统登录页输入此卡密即可直接开启使用。请妥善保存。"
    )
    return send_email(email, subject, html_content, text_content)
