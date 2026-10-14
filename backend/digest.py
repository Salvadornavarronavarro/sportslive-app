"""
LiveSports - Servicio de Resumen Semanal de Suscriptores y Registro de Usuarios
Genera y envía automáticamente un informe periódico vía correo electrónico (SMTP)
al administrador con las métricas de registro, nuevos usuarios y clubes favoritos seguidos.
"""

from __future__ import annotations

import os
import sys
import smtplib
import datetime
import threading
import time
import json
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from backend.db import get_subscribers_summary

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
    send_password_reset_email,
    send_verification_email
)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DIGEST_STATE_FILE = os.path.join(DATA_DIR, ".last_digest_run.json")

_digest_lock = threading.Lock()
_last_digest_info = {
    "last_run": None,
    "last_recipient": None,
    "last_status": "initialized",
    "total_subscribers": 0,
    "new_last_7_days": 0
}


def _load_last_run_timestamp() -> float | None:
    """Carga la marca de tiempo de la última ejecución del digest si existe."""
    if os.path.exists(DIGEST_STATE_FILE):
        try:
            with open(DIGEST_STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("timestamp")
        except Exception:
            pass
    return None


def _save_last_run_timestamp(ts: float, recipient: str, total: int, new_count: int):
    """Guarda en disco la marca de tiempo del último envío del digest."""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(DIGEST_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "timestamp": ts,
                "iso_date": datetime.datetime.fromtimestamp(ts).isoformat(),
                "recipient": recipient,
                "total_subscribers": total,
                "new_last_7_days": new_count
            }, f, indent=2)
    except Exception as e:
        print(f"⚠️ Error guardando estado de digest: {e}")


def build_digest_content(summary: dict) -> tuple[str, str]:
    """
    Construye las versiones de texto plano y HTML enriquecido
    del informe de suscriptores para LiveSports.
    """
    now_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")
    total = summary.get("total", 0)
    new_count = summary.get("new_last_7_days", 0)
    subscribers = summary.get("subscribers", [])

    # 1. Versión de Texto Plano
    plain_lines = [
        "==================================================",
        "🏆 LIVESPORTS - RESUMEN SEMANAL DE SUSCRIPTORES",
        "==================================================",
        f"Fecha del informe: {now_str}",
        f"Total de usuarios registrados: {total}",
        f"Nuevos usuarios en los últimos 7 días: +{new_count}",
        "--------------------------------------------------",
        "LISTADO DE USUARIOS REGISTRADOS:",
        "--------------------------------------------------"
    ]

    for s in subscribers:
        email = s.get("email") or "Sin email"
        name = s.get("full_name") or s.get("username") or "Anónimo"
        role = s.get("role", "viewer").upper()
        reg_date = s.get("created_at", "")[:10]
        favs = ", ".join(s.get("favorite_clubs") or []) or "Ninguno"
        new_tag = " [¡NUEVO!]" if s.get("is_new_7_days") else ""
        plain_lines.append(f"• {email} ({name}) - Rol: {role} - Registro: {reg_date} - Clubes favoritos: [{favs}]{new_tag}")

    plain_lines.extend([
        "--------------------------------------------------",
        "Este es un informe automático generado por LiveSports.",
        "Accede al panel de administración en: https://livesports.es (o localhost:3000)",
        "=================================================="
    ])
    plain_text = "\n".join(plain_lines)

    # 2. Versión HTML con diseño moderno responsivo
    rows_html = []
    for s in subscribers:
        email = s.get("email") or "-"
        name = s.get("full_name") or s.get("username") or "-"
        role = s.get("role", "viewer")
        role_label = {
            "admin": "👑 Administrador",
            "club": "🛡️ Club Oficial",
            "viewer": "👤 Aficionado",
            "aficionado": "👤 Aficionado"
        }.get(role, role)

        reg_str = s.get("created_at", "")
        if reg_str:
            try:
                dt = datetime.datetime.fromisoformat(reg_str.replace("Z", "").split("+")[0])
                reg_fmt = dt.strftime("%d/%m/%Y")
            except Exception:
                reg_fmt = reg_str[:10]
        else:
            reg_fmt = "-"

        fav_clubs = s.get("favorite_clubs") or []
        if fav_clubs:
            favs_html = " ".join([
                f'<span style="display:inline-block; background:#1e293b; color:#38bdf8; padding:2px 8px; border-radius:12px; font-size:11px; margin:2px; border:1px solid rgba(56,189,248,0.2);">{c}</span>'
                for c in fav_clubs
            ])
        else:
            favs_html = '<span style="color:#64748b; font-size:12px; font-style:italic;">Sin clubes seleccionados</span>'

        new_badge = ""
        if s.get("is_new_7_days"):
            new_badge = ' <span style="background:#10b981; color:#ffffff; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:8px; text-transform:uppercase;">NUEVO</span>'

        rows_html.append(f"""
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 10px 12px; font-weight: 600; color: #f8fafc;">
            <a href="mailto:{email}" style="color: #38bdf8; text-decoration: none;">{email}</a>{new_badge}
          </td>
          <td style="padding: 10px 12px; color: #cbd5e1;">{name}</td>
          <td style="padding: 10px 12px; color: #e2e8f0; font-size: 12px;">{role_label}</td>
          <td style="padding: 10px 12px; color: #94a3b8; font-size: 12px;">{reg_fmt}</td>
          <td style="padding: 10px 12px;">{favs_html}</td>
        </tr>
        """)

    table_rows_str = "".join(rows_html)

    html_content = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>LiveSports - Resumen Semanal de Suscriptores</title>
</head>
<body style="margin:0; padding:0; background-color:#0b1120; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0b1120; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px; width:100%; background-color:#0f172a; border-radius:12px; border:1px solid #1e293b; overflow:hidden; box-shadow:0 10px 25px -5px rgba(0, 0, 0, 0.5);">
          
          <!-- Encabezado con branding -->
          <tr>
            <td style="background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%); padding: 24px 28px; text-align: left;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">LiveSports</h1>
              <p style="margin: 6px 0 0 0; color: #e0f2fe; font-size: 14px;">Resumen Semanal de Suscriptores y Registros</p>
            </td>
          </tr>

          <!-- Tarjetas de Métricas -->
          <tr>
            <td style="padding: 24px 28px 12px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="48%" style="background:#1e293b; border-radius:10px; padding:16px 20px; border:1px solid rgba(56,189,248,0.2);">
                    <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700; letter-spacing:0.5px;">👥 Total Suscriptores</div>
                    <div style="font-size:32px; font-weight:800; color:#38bdf8; margin-top:4px;">{total}</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background:#1e293b; border-radius:10px; padding:16px 20px; border:1px solid rgba(16,185,129,0.2);">
                    <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700; letter-spacing:0.5px;">🆕 Nuevos en 7 Días</div>
                    <div style="font-size:32px; font-weight:800; color:#10b981; margin-top:4px;">+{new_count}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Detalle de Fecha -->
          <tr>
            <td style="padding: 0 28px 16px 28px;">
              <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                📅 <strong>Fecha de corte:</strong> {now_str} • Datos sincronizados desde la base de datos de LiveSports.
              </p>
            </td>
          </tr>

          <!-- Tabla de Suscriptores -->
          <tr>
            <td style="padding: 0 28px 24px 28px;">
              <div style="background:#0b1120; border-radius:8px; border:1px solid #1e293b; overflow:hidden;">
                <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-size:13px; text-align:left;">
                  <thead>
                    <tr style="background:#1e293b; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">
                      <th style="padding:10px 12px; border-bottom:1px solid #334155;">Correo Electrónico</th>
                      <th style="padding:10px 12px; border-bottom:1px solid #334155;">Nombre</th>
                      <th style="padding:10px 12px; border-bottom:1px solid #334155;">Rol</th>
                      <th style="padding:10px 12px; border-bottom:1px solid #334155;">Fecha</th>
                      <th style="padding:10px 12px; border-bottom:1px solid #334155;">Clubes Favoritos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table_rows_str}
                  </tbody>
                </table>
              </div>
            </td>
          </tr>

          <!-- Pie de página -->
          <tr>
            <td style="background:#090d16; padding:18px 28px; border-top:1px solid #1e293b; text-align:center;">
              <p style="margin:0; font-size:12px; color:#64748b;">
                LiveSports • Plataforma de Deporte Base en Directo • Este informe se envía periódicamente a la administración ({ADMIN_EMAIL}).
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    return plain_text, html_content


def send_subscribers_digest(target_email: str = None, is_manual: bool = False) -> dict:
    """
    Envía el resumen de suscriptores al correo del administrador (dragontvsalva@gmail.com).
    Remitente oficial del sistema: LiveSports <alicanteparadisestudios@gmail.com>.
    Si SMTP_PASS no está configurado, opera en modo de simulación segura sin provocar errores.
    """
    cfg = get_email_config()
    recipient = (target_email or os.environ.get("DIGEST_RECIPIENT") or cfg["admin_email"]).strip()
    summary = get_subscribers_summary()
    total = summary.get("total", 0)
    new_count = summary.get("new_last_7_days", 0)

    plain_body, html_body = build_digest_content(summary)

    # Si SMTP_PASS no está configurado en el entorno (modo simulación)
    if not cfg["password"]:
        print(f"📧 [LiveSports Digest] SMTP_PASS no configurado (modo simulación).")
        print(f"   Remitente oficial: {cfg['from']}")
        print(f"   Destinatario admin: {recipient} ({total} suscriptores, +{new_count} nuevos en 7 días). Simulación exitosa.")
        with _digest_lock:
            _last_digest_info.update({
                "last_run": datetime.datetime.now().isoformat(),
                "last_recipient": recipient,
                "last_status": "simulated_success",
                "total_subscribers": total,
                "new_last_7_days": new_count
            })
        _save_last_run_timestamp(time.time(), recipient, total, new_count)
        return {
            "success": True,
            "simulated": True,
            "sender": cfg["from"],
            "recipient": recipient,
            "message": f"Resumen generado exitosamente para {recipient} desde {cfg['from']} ({total} usuarios, +{new_count} nuevos). Modo simulación activo.",
            "total_subscribers": total,
            "new_last_7_days": new_count
        }

    # Envío real a través de SMTP
    envelope_sender = get_envelope_sender(cfg["from"], cfg["user"])
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"📊 LiveSports: Resumen Semanal de Suscriptores ({total} usuarios, +{new_count} nuevos)"
        msg["From"] = cfg["from"]
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

        print(f"✅ [LiveSports Digest] Resumen de suscriptores enviado exitosamente a {recipient} desde {cfg['from']} ({total} suscriptores).")
        with _digest_lock:
            _last_digest_info.update({
                "last_run": datetime.datetime.now().isoformat(),
                "last_recipient": recipient,
                "last_status": "sent_success",
                "total_subscribers": total,
                "new_last_7_days": new_count
            })
        _save_last_run_timestamp(time.time(), recipient, total, new_count)
        return {
            "success": True,
            "simulated": False,
            "sender": cfg["from"],
            "recipient": recipient,
            "message": f"Resumen de suscriptores enviado exitosamente a {recipient} desde {cfg['from']}.",
            "total_subscribers": total,
            "new_last_7_days": new_count
        }
    except Exception as err:
        err_msg = str(err)
        print(f"⚠️ [LiveSports Digest Error]: {err_msg}")
        with _digest_lock:
            _last_digest_info.update({
                "last_run": datetime.datetime.now().isoformat(),
                "last_recipient": recipient,
                "last_status": f"error: {err_msg}",
                "total_subscribers": total,
                "new_last_7_days": new_count
            })
        return {
            "success": False,
            "simulated": False,
            "sender": cfg["from"],
            "recipient": recipient,
            "error": f"Error SMTP al enviar a {recipient}: {err_msg}",
            "total_subscribers": total,
            "new_last_7_days": new_count
        }


def get_digest_status() -> dict:
    """Devuelve el estado y configuración del sistema de digest semanal."""
    cfg = get_email_config()
    with _digest_lock:
        info = dict(_last_digest_info)
    info.update({
        "smtp_configured": bool(cfg["password"]),
        "smtp_host": cfg["host"],
        "smtp_port": cfg["port"],
        "smtp_user": cfg["user"],
        "smtp_from": cfg["from"],
        "admin_email": cfg["admin_email"]
    })
    return info


_scheduler_started = False

def start_weekly_digest_scheduler():
    """
    Inicia el programador en segundo plano (daemon thread)
    que comprueba de forma continua y envía el informe una vez por semana (cada 7 días).
    Garantiza ejecución estrictamente no bloqueante como daemon thread.
    """
    global _scheduler_started
    with _digest_lock:
        if _scheduler_started:
            return None
        _scheduler_started = True

    def _scheduler_worker():
        # Ciclo semanal: 7 días = 7 * 24 * 3600 segundos
        WEEK_SECONDS = 7 * 24 * 3600

        print(f"📅 [LiveSports Digest Scheduler] Iniciado en segundo plano (frecuencia: semanal a {ADMIN_EMAIL}).")

        # Verificar cuándo se ejecutó por última vez
        try:
            last_ts = _load_last_run_timestamp()
            if last_ts is None:
                _save_last_run_timestamp(time.time(), ADMIN_EMAIL, 0, 0)
                last_ts = time.time()
        except Exception as _e:
            print(f"⚠️ Error cargando estado inicial de digest: {_e}")
            last_ts = time.time()

        while True:
            try:
                # Comprobar cada hora (3600 segundos) si ha transcurrido una semana
                time.sleep(3600)
                now_ts = time.time()
                elapsed = now_ts - (last_ts or 0)

                if elapsed >= WEEK_SECONDS:
                    print(f"⏰ [LiveSports Digest Scheduler] Ejecutando envío automático semanal a {ADMIN_EMAIL}...")
                    send_subscribers_digest(target_email=ADMIN_EMAIL, is_manual=False)
                    last_ts = now_ts
            except Exception as e:
                print(f"⚠️ [LiveSports Digest Scheduler Error]: {e}")
                time.sleep(60)

    sched_thread = threading.Thread(
        target=_scheduler_worker,
        daemon=True,
        name="WeeklySubscribersDigestScheduler"
    )
    sched_thread.start()
    return sched_thread


