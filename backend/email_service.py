"""
LiveSports - Servicio Central de Correo Electrónico (Email Service)
Configuración y utilidades de envío SMTP para notificaciones, digest semanal
y recuperación de contraseñas de LiveSports.

Remitente oficial del sistema: alicanteparadisestudios@gmail.com
Nombre visible del remitente: LiveSports <alicanteparadisestudios@gmail.com>
Destinatario administrativo por defecto: dragontvsalva@gmail.com
"""

from __future__ import annotations

import os
import sys
import smtplib
import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parseaddr

# ==========================================================
# CONFIGURACIÓN SMTP PREDETERMINADA Y DINÁMICA
# ==========================================================
DEFAULT_SMTP_HOST = "smtp.gmail.com"
DEFAULT_SMTP_PORT = 587
DEFAULT_SMTP_USER = "alicanteparadisestudios@gmail.com"
DEFAULT_SMTP_FROM = "LiveSports <alicanteparadisestudios@gmail.com>"
DEFAULT_ADMIN_EMAIL = "dragontvsalva@gmail.com"


def get_email_config() -> dict:
    """
    Obtiene la configuración SMTP leyendo dinámicamente las variables de entorno,
    con valores predeterminados seguros para el sistema LiveSports.
    """
    smtp_host = os.environ.get("SMTP_HOST", DEFAULT_SMTP_HOST).strip()
    try:
        smtp_port = int(os.environ.get("SMTP_PORT", str(DEFAULT_SMTP_PORT)))
    except (ValueError, TypeError):
        smtp_port = DEFAULT_SMTP_PORT

    smtp_user = os.environ.get("SMTP_USER", DEFAULT_SMTP_USER).strip()
    smtp_pass = os.environ.get("SMTP_PASS", "").strip()

    # Si se definió SMTP_FROM explícitamente se respeta; en caso contrario, se compone con el remitente del sistema
    env_from = os.environ.get("SMTP_FROM", "").strip()
    if env_from:
        if "<" not in env_from and "@" in env_from:
            smtp_from = f"LiveSports <{env_from}>"
        else:
            smtp_from = env_from
    else:
        smtp_from = f"LiveSports <{smtp_user}>"

    admin_email = (
        os.environ.get("ADMIN_EMAIL")
        or os.environ.get("DIGEST_RECIPIENT")
        or DEFAULT_ADMIN_EMAIL
    ).strip()

    use_ssl = os.environ.get("SMTP_USE_SSL", "false").lower() in ("true", "1", "yes")

    return {
        "host": smtp_host,
        "port": smtp_port,
        "user": smtp_user,
        "password": smtp_pass,
        "from": smtp_from,
        "admin_email": admin_email,
        "use_ssl": use_ssl
    }


def get_envelope_sender(from_header: str = None, smtp_user: str = None) -> str:
    """Extrae la dirección pura de correo para el envelope MAIL FROM de SMTP."""
    cfg = get_email_config()
    header = from_header or cfg["from"]
    user = smtp_user or cfg["user"]
    _, email_addr = parseaddr(header)
    return email_addr or user or DEFAULT_SMTP_USER


# Variables a nivel de módulo para compatibilidad con código existente
SMTP_HOST = os.environ.get("SMTP_HOST", DEFAULT_SMTP_HOST)
SMTP_PORT = int(os.environ.get("SMTP_PORT", str(DEFAULT_SMTP_PORT)))
SMTP_USER = os.environ.get("SMTP_USER", DEFAULT_SMTP_USER)
SMTP_PASS = os.environ.get("SMTP_PASS", "")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", os.environ.get("DIGEST_RECIPIENT", DEFAULT_ADMIN_EMAIL))
SMTP_FROM = os.environ.get("SMTP_FROM", DEFAULT_SMTP_FROM)
SMTP_USE_SSL = os.environ.get("SMTP_USE_SSL", "false").lower() in ("true", "1", "yes")


def send_generic_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str = "",
    from_header: str = None
) -> dict:
    """
    Envía un correo genérico con remitente LiveSports <alicanteparadisestudios@gmail.com>.
    Si SMTP_PASS no está configurado, opera en modo de simulación segura.
    """
    cfg = get_email_config()
    recipient = to_email.strip()
    sender_header = from_header or cfg["from"]
    envelope_sender = get_envelope_sender(sender_header, cfg["user"])

    if not cfg["password"]:
        print(f"📧 [LiveSports Mailer] Modo simulación (sin credenciales SMTP_PASS).")
        print(f"   Remitente: {sender_header}")
        print(f"   Destinatario: {recipient}")
        print(f"   Asunto: {subject}")
        return {
            "sent": True,
            "simulated": True,
            "sender": sender_header,
            "recipient": recipient,
            "subject": subject,
            "message": f"Modo simulación: correo generado para {recipient} desde {sender_header}."
        }

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = sender_header
        msg["To"] = recipient

        if text_content:
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
        if html_content:
            msg.attach(MIMEText(html_content, "html", "utf-8"))

        if cfg["use_ssl"] or cfg["port"] == 465:
            server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20)
        else:
            server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20)
            server.starttls()

        if cfg["user"] and cfg["password"]:
            server.login(cfg["user"], cfg["password"])

        server.sendmail(envelope_sender, [recipient], msg.as_string())
        server.quit()

        print(f"✅ [LiveSports Mailer] Correo enviado exitosamente a {recipient} desde {sender_header}.")
        return {
            "sent": True,
            "simulated": False,
            "sender": sender_header,
            "recipient": recipient,
            "message": f"Correo enviado exitosamente a {recipient}."
        }
    except Exception as err:
        err_msg = str(err)
        print(f"⚠️ [LiveSports Mailer Error]: {err_msg}")
        return {
            "sent": False,
            "simulated": False,
            "sender": sender_header,
            "recipient": recipient,
            "error": f"Error SMTP al enviar correo a {recipient}: {err_msg}"
        }


def send_password_reset_email(email: str, reset_url: str, token: str, username: str = None) -> dict:
    """
    Envía el correo de recuperación de contraseña con el enlace seguro y el token,
    mostrando claramente 'LiveSports <alicanteparadisestudios@gmail.com>' como remitente.
    """
    cfg = get_email_config()
    recipient = email.strip()
    user_display = username or recipient.split("@")[0]
    sender_header = cfg["from"]
    envelope_sender = get_envelope_sender(sender_header, cfg["user"])

    plain_body = f"""==================================================
🔐 LIVESPORTS - RECUPERACIÓN DE CONTRASEÑA
==================================================
Remitente: {sender_header}
Hola, {user_display}:

Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en LiveSports ({recipient}).

Para crear una nueva contraseña, accede al siguiente enlace seguro:
{reset_url}

Código de recuperación directo:
{token}

Este enlace y código son válidos durante 1 hora.
Si no has solicitado este cambio, puedes ignorar este correo; tu contraseña actual continuará siendo segura.

--------------------------------------------------
LiveSports • Plataforma de Deporte Base en Directo
Remitente del sistema: {sender_header}
=================================================="""

    html_body = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recuperación de Contraseña - LiveSports</title>
</head>
<body style="margin:0; padding:0; background-color:#0b1120; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0b1120; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="580" cellspacing="0" cellpadding="0" style="max-width:580px; width:100%; background-color:#0f172a; border-radius:12px; border:1px solid #1e293b; overflow:hidden; box-shadow:0 10px 25px -5px rgba(0, 0, 0, 0.5);">
          
          <!-- Encabezado con branding y remitente claro -->
          <tr>
            <td style="background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%); padding: 24px 28px; text-align: left;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">LiveSports</h1>
              <p style="margin: 6px 0 0 0; color: #e0f2fe; font-size: 13px;">Remitente: <strong>{sender_header}</strong></p>
            </td>
          </tr>

          <!-- Contenido Principal -->
          <tr>
            <td style="padding: 28px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #f8fafc; line-height: 1.5;">
                Hola <strong>{user_display}</strong>,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; color: #cbd5e1; line-height: 1.6;">
                Hemos recibido una solicitud para restablecer la contraseña asociada a tu cuenta (<strong>{recipient}</strong>) en LiveSports. Haz clic en el botón para definir tu nueva contraseña:
              </p>

              <!-- Botón CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px; background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);">
                    <a href="{reset_url}" target="_blank" style="font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; padding: 12px 28px; display: inline-block; border-radius: 8px;">
                      Restablecer Mi Contraseña →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Caja de Token Alternativo -->
              <div style="background: #1e293b; border-radius: 8px; border: 1px solid rgba(56,189,248,0.2); padding: 14px 18px; margin: 20px 0;">
                <span style="font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Código de recuperación directo:</span>
                <code style="font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all;">{token}</code>
              </div>

              <p style="margin: 16px 0 0 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
                ⏳ Este enlace expirará en <strong>1 hora</strong> por motivos de seguridad.<br>
                Si tú no has solicitado este cambio, puedes ignorar este mensaje; tu contraseña actual continuará siendo segura.
              </p>
            </td>
          </tr>

          <!-- Pie de página con remitente explícito -->
          <tr>
            <td style="background:#090d16; padding:16px 28px; border-top:1px solid #1e293b; text-align:center;">
              <p style="margin:0; font-size:12px; color:#64748b;">
                LiveSports • Correo emitido desde <strong>{sender_header}</strong> • Mensaje automático de seguridad.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    # Modo simulación si SMTP_PASS no está configurado
    if not cfg["password"]:
        print(f"🔐 [LiveSports Password Reset] SMTP_PASS no configurado (modo simulación).")
        print(f"   Remitente: {sender_header}")
        print(f"   Destinatario: {recipient}")
        print(f"   Token: {token}")
        print(f"   Enlace directo: {reset_url}")
        return {
            "sent": True,
            "simulated": True,
            "sender": sender_header,
            "recipient": recipient,
            "token": token,
            "reset_url": reset_url,
            "message": f"Modo simulación: enlace de recuperación generado para {recipient} desde {sender_header}."
        }

    # Envío real a través de SMTP
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "🔐 LiveSports: Recuperación de contraseña"
        msg["From"] = sender_header
        msg["To"] = recipient

        part1 = MIMEText(plain_body, "plain", "utf-8")
        part2 = MIMEText(html_body, "html", "utf-8")
        msg.attach(part1)
        msg.attach(part2)

        if cfg["use_ssl"] or cfg["port"] == 465:
            server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20)
        else:
            server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20)
            server.starttls()

        if cfg["user"] and cfg["password"]:
            server.login(cfg["user"], cfg["password"])

        server.sendmail(envelope_sender, [recipient], msg.as_string())
        server.quit()

        print(f"✅ [LiveSports Password Reset] Email de recuperación enviado a {recipient} desde {sender_header}.")
        return {
            "sent": True,
            "simulated": False,
            "sender": sender_header,
            "recipient": recipient,
            "message": f"Enlace de recuperación enviado exitosamente a {recipient} desde {sender_header}."
        }
    except Exception as err:
        err_msg = str(err)
        print(f"⚠️ [LiveSports Password Reset Error]: {err_msg}")
        return {
            "sent": False,
            "simulated": False,
            "sender": sender_header,
            "recipient": recipient,
            "error": f"Error SMTP al enviar correo a {recipient}: {err_msg}",
            "token": token,
            "reset_url": reset_url
        }
