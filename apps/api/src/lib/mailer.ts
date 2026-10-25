export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Resend over plain fetch. Failures are logged, never thrown: a dropped
 * email must not fail the request that triggered it. */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(email) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, ...email }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) console.error(`[mail] Resend ${res.status}: ${await res.text()}`);
      } catch (err) {
        console.error("[mail] send failed:", err instanceof Error ? err.message : err);
      }
    },
  };
}

export const logMailer: Mailer = {
  async send(email) {
    console.log(`[mail] (not sent, no RESEND_API_KEY) to=${email.to} subject="${email.subject}"`);
  },
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, well-behaved transactional email layout. */
export function renderEmail(opts: {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
}): { text: string; html: string } {
  const text = [
    opts.heading,
    "",
    ...opts.paragraphs,
    ...(opts.action ? ["", `${opts.action.label}: ${opts.action.url}`] : []),
    "",
    opts.footer ?? "EasyTenant",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#151821">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e6eb;border-radius:12px">
<tr><td style="padding:28px 28px 8px"><div style="font-weight:700;font-size:15px;color:#2546d8">EasyTenant</div></td></tr>
<tr><td style="padding:8px 28px 0"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(opts.heading)}</h1>
${opts.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3c4150">${esc(p)}</p>`).join("")}
</td></tr>
${opts.action ? `<tr><td style="padding:8px 28px 24px"><a href="${esc(opts.action.url)}" style="display:inline-block;background:#2546d8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 18px;border-radius:8px">${esc(opts.action.label)}</a></td></tr>` : ""}
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eef0f3;font-size:12px;color:#7a7f8c">${esc(opts.footer ?? "You're receiving this because you have an EasyTenant account.")}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
