import { tocaEsteMes } from '../../shared/periodicidad.js';

const JAY_EMAIL = 'jgmansur2@gmail.com';

export function normalizeEmails(values = []) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

export function dueDateForMonth(year, month, day) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(Math.max(Number(day) || 1, 1), last)).padStart(2, '0')}`;
}

export function reminderOffsets(today, dueDate) {
    const start = Date.parse(`${today}T00:00:00Z`);
    const end = Date.parse(`${dueDate}T00:00:00Z`);
    const days = Math.round((end - start) / 86400000);
    return days === 3 || days === 0 ? [days] : [];
}

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function sendWithResend(env, payload) {
    if (!env.FINANCE_REMINDER_SECRET) throw new Error('FINANCE_REMINDER_SECRET no configurado');
    const response = await fetch('https://musicknobs.com/api/finance-reminder', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${env.FINANCE_REMINDER_SECRET}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ to: payload.to, subject: payload.subject, text: payload.text, html: payload.html }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Resend ${response.status}`);
    return body.id || null;
}

export async function sendFixedExpenseReminders({ sql, env, now = new Date() }) {
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    const [year, month] = today.split('-').map(Number);
    const period = `${year}-${String(month).padStart(2, '0')}-01`;
    const rows = await sql`
        select f.id, f.concepto, f.monto, f.moneda, f.dia_mes, f.pagos_mes, f.alert_emails,
               f.paid_through, f.periodicidad, f.inicio_mes,
               coalesce(bool_and(coalesce(p.paid, false) or coalesce(p.waived, false)), false) as fully_paid,
               count(p.id)::int as payment_rows
        from fixed_expenses f
        left join fixed_expense_payments p
          on p.fixed_expense_id = f.id and p.period = ${period}::date
        where f.active and cardinality(f.alert_emails) > 0
          and lower(coalesce(f.tipo, 'gasto')) = 'gasto'
        group by f.id
    `;
    let sent = 0;
    for (const fixed of rows) {
        if (!tocaEsteMes(fixed.periodicidad, fixed.inicio_mes, `${year}-${String(month).padStart(2, '0')}`)) continue;
        const dueDate = dueDateForMonth(year, month, fixed.dia_mes);
        const offsets = reminderOffsets(today, dueDate);
        const fullyPaid = fixed.fully_paid && Number(fixed.payment_rows) >= Number(fixed.pagos_mes || 1);
        if (!offsets.length || fullyPaid || (fixed.paid_through && String(fixed.paid_through).slice(0, 10) >= dueDate)) continue;
        for (const recipient of normalizeEmails(fixed.alert_emails)) {
            const [claimed] = await sql`
                insert into fixed_expense_alerts (fixed_expense_id, due_date, alert_offset_days, recipient)
                values (${fixed.id}, ${dueDate}::date, ${offsets[0]}, ${recipient})
                on conflict do nothing returning id
            `;
            if (!claimed) continue;
            try {
                const when = offsets[0] === 0 ? 'vence hoy' : 'vence en 3 días';
                const providerId = await sendWithResend(env, {
                    to: [recipient],
                    subject: `${fixed.concepto} ${when}`,
                    text: `${fixed.concepto} ${when} (${dueDate}). Monto: ${fixed.moneda || 'MXN'} ${Number(fixed.monto).toFixed(2)}.`,
                    html: `<p><strong>${escapeHtml(fixed.concepto)}</strong> ${when}.</p><p>Fecha: ${dueDate}<br>Monto: ${escapeHtml(fixed.moneda || 'MXN')} ${Number(fixed.monto).toFixed(2)}</p>`,
                });
                await sql`update fixed_expense_alerts set provider_id = ${providerId} where id = ${claimed.id}`;
                sent += 1;
            } catch (error) {
                await sql`delete from fixed_expense_alerts where id = ${claimed.id}`;
                console.error('recordatorio fijo', fixed.id, recipient, error.message);
            }
        }
    }
    return { checked: rows.length, sent };
}

export { JAY_EMAIL };
