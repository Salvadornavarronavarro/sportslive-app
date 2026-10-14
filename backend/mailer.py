"""
LiveSports - Módulo Mailer
Proporciona la interfaz de envío de correo electrónico del sistema LiveSports,
utilizando backend.email_service como núcleo del servicio.

Remitente oficial: alicanteparadisestudios@gmail.com
Display Name: LiveSports <alicanteparadisestudios@gmail.com>
Administrador (destinatario de informes y digests): dragontvsalva@gmail.com
"""

from backend.email_service import (
    DEFAULT_SMTP_HOST,
    DEFAULT_SMTP_PORT,
    DEFAULT_SMTP_USER,
    DEFAULT_SMTP_FROM,
    DEFAULT_ADMIN_EMAIL,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    ADMIN_EMAIL,
    SMTP_FROM,
    SMTP_USE_SSL,
    get_email_config,
    get_envelope_sender,
    send_generic_email,
    send_password_reset_email,
    send_verification_email
)

__all__ = [
    "DEFAULT_SMTP_HOST",
    "DEFAULT_SMTP_PORT",
    "DEFAULT_SMTP_USER",
    "DEFAULT_SMTP_FROM",
    "DEFAULT_ADMIN_EMAIL",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "ADMIN_EMAIL",
    "SMTP_FROM",
    "SMTP_USE_SSL",
    "get_email_config",
    "get_envelope_sender",
    "send_generic_email",
    "send_password_reset_email",
    "send_verification_email"
]
