// Transactional emails (sign-up confirmation, password reset) through Resend.
import type { Env } from "./index";
import { bump } from "./ops";
import { DEMO_DOMAIN } from "./demo-authors";

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// One button email: title, a line of text, the link, and a quiet footer.
function layout(title: string, text: string, button: string, link: string) {
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f5f3ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2140">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:22px;font-weight:800;color:#151a3d;padding-bottom:6px">hop<span style="color:#ff5436">v</span>ote</td></tr>
<tr><td style="font-size:20px;font-weight:700;padding:18px 0 8px">${escape(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#565a73;padding-bottom:24px">${escape(text)}</td></tr>
<tr><td><a href="${link}" style="display:inline-block;background:#ff5436;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:12px">${escape(button)}</a></td></tr>
<tr><td style="font-size:12px;line-height:1.5;color:#8a8ea8;padding-top:28px">If you didn't ask for this, ignore this email. The link expires soon and works once.</td></tr>
</table></td></tr></table></body></html>`;
  return { html, text: `${title}\n\n${text}\n\n${button}: ${link}\n\nIf you didn't ask for this, ignore this email.` };
}

export async function sendMail(env: Env, to: string, subject: string, title: string, text: string, button: string, link: string) {
  // The fictional Community authors of the demo seed have no inbox: never spend an email on them.
  if (to.trim().toLowerCase().endsWith(`@${DEMO_DOMAIN}`)) return false;
  const body = layout(title, text, button, link);
  // Local development: no email service, the link goes to the console.
  if (!env.RESEND_API_KEY) {
    console.log(`[mail] to ${to}: ${subject} ${link}`);
    return env.MAIL_DEV === "1";
  }
  // The sender is a setting (MAIL_FROM in wrangler.jsonc), on a domain verified in Resend.
  if (!env.MAIL_FROM) {
    console.log("[mail] MAIL_FROM is not set: nothing sent");
    return false;
  }
  // A slow or unreachable Resend counts as a failed send, not an unhandled error.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html: body.html, text: body.text }),
    signal: AbortSignal.timeout(10000),
  }).catch((e) => {
    console.log(`[mail] unreachable ${e instanceof Error ? e.message : e}`);
    return null;
  });
  if (!res) return false;
  if (!res.ok) console.log(`[mail] failed ${res.status} ${await res.text().catch(() => "")}`);
  // Counted for the day's email cap (auth.ts mailLimit).
  else await bump(env, "emails");
  return res.ok;
}
