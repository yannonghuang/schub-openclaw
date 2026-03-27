import smtplib
from email.message import EmailMessage

def send_mail(
    to_addrs: list[str],  
    frontend_url: str, 
    token: str,
    businessStr: str = None, # reset if None, invite if not None
    smtp_host: str = "smtp.gmail.com",
    smtp_port: int = 587,
    username: str = "",
    password: str = "",
    #subject: str = "Password reset",
    from_addr: str = "",
):
    link = f"{frontend_url}/reset-password?token={token}" if businessStr is None else f"{frontend_url}/signup?{businessStr}"

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)

    # 1) set a plain‐text fallback
    if businessStr is None:
      msg.set_content(
          f"Please use the following link to reset your password:\n{link}\n\n"
          "If you did not request this, you can safely ignore this email."
      )
    # 2) add an HTML version, with a clickable hyperlink
      msg.add_alternative(f"""\
      <html>
        <body>
          <p>Please click the link below to reset your password:</p>
          <p><a href="{link}">Reset your password</a></p>
          <hr>
          <p>If you did not request this, you can safely ignore this email.</p>
        </body>
      </html>
      """, subtype="html")

      subject: str = "Password reset"
    else:
      msg.set_content(
          f"Please use the following link to signup:\n{link}\n\n"
      )
      msg.add_alternative(f"""\
      <html>
        <body>
          <p>Please click the link below to signup:</p>
          <p><a href="{link}">signup</a></p>
        </body>
      </html>
      """, subtype="html")      

      subject: str = "Invite"

    msg["Subject"] = subject
    
    with smtplib.SMTP(smtp_host, smtp_port) as client:
        client.starttls()           # if your server supports TLS
        client.login(username, password)
        client.send_message(msg)


def send_reset_email(smtp_host, smtp_port, username, password, to_addr, frontend_url, token):
    reset_link = f"{frontend_url}/reset-password?token={token}"

    msg = EmailMessage()
    msg["Subject"] = "Password Reset Request"
    msg["From"] = username
    msg["To"] = to_addr

    # 1) set a plain‐text fallback
    msg.set_content(
        f"Please use the following link to reset your password:\n{reset_link}\n\n"
        "If you did not request this, you can safely ignore this email."
    )

    # 2) add an HTML version, with a clickable hyperlink
    msg.add_alternative(f"""\
    <html>
      <body>
        <p>Please click the link below to reset your password:</p>
        <p><a href="{reset_link}">Reset your password</a></p>
        <hr>
        <p>If you did not request this, you can safely ignore this email.</p>
      </body>
    </html>
    """, subtype="html")

    # send it
    with smtplib.SMTP(smtp_host, smtp_port) as smtp:
        smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(msg)
