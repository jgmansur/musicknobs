-- Email reminders configured per fixed expense.
alter table fixed_expenses
    add column if not exists alert_emails text[] not null default '{}';

create table if not exists notification_contacts (
    email text primary key,
    created_at timestamptz not null default now()
);

create table if not exists fixed_expense_alerts (
    id uuid primary key default gen_random_uuid(),
    fixed_expense_id uuid not null references fixed_expenses (id) on delete cascade,
    due_date date not null,
    alert_offset_days int not null,
    recipient text not null,
    provider_id text,
    sent_at timestamptz not null default now(),
    unique (fixed_expense_id, due_date, alert_offset_days, recipient)
);

create index if not exists fixed_expense_alerts_due_idx
    on fixed_expense_alerts (due_date, fixed_expense_id);

-- Remove internal filter tokens accidentally persisted as categories by the
-- previous shared checkbox renderer.
update fixed_expenses f
set categoria = coalesce((
    select string_agg(trim(part), ', ' order by ord)
    from unnest(string_to_array(f.categoria, ',')) with ordinality as pieces(part, ord)
    where trim(part) not like '__tipo_%'
), 'General')
where categoria like '%__tipo_%';
