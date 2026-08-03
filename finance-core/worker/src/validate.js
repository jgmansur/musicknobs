/**
 * Corre los parsers sobre los fixtures reales y reporta la cobertura.
 *
 *   node src/validate.js            resumen
 *   node src/validate.js --misses   además, los asuntos que no hicieron match
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBankEmail, htmlToText } from './parsers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'fixtures');
const showMisses = process.argv.includes('--misses');

const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));

const byTemplate = new Map();
const byReason = new Map();
const missSubjects = new Map();
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

let matched = 0;
const samples = [];

for (const file of files) {
    const msg = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
    const result = parseBankEmail({
        from: msg.from,
        subject: msg.subject,
        html: msg.html,
        receivedAt: new Date(Number(msg.internalDate)),
    });

    if (result.matched) {
        matched += 1;
        bump(byTemplate, result.template);
        if (samples.length < 8 || !samples.some((s) => s.template === result.template)) {
            samples.push({
                template: result.template,
                merchant: result.merchant ?? result.counterparty ?? '—',
                amount: result.amount,
                card: result.cardLast4 ?? '—',
                kind: result.kind,
            });
        }
    } else {
        bump(byReason, result.reason);
        if (result.reason !== 'marketing') {
            const key = `${result.reason} :: ${msg.subject}`;
            bump(missSubjects, key);
        }
    }
}

const pct = (n) => ((n / files.length) * 100).toFixed(1);

console.log(`Fixtures: ${files.length}`);
console.log(`Con match: ${matched} (${pct(matched)}%)\n`);

console.log('Por plantilla:');
for (const [t, n] of [...byTemplate].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${t}`);
}

console.log('\nDescartados:');
for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${r}`);
}

console.log('\nMuestras extraídas:');
for (const s of samples.slice(0, 8)) {
    const amount = s.amount == null ? '—' : `$${s.amount}`;
    console.log(`  [${s.kind}] ${s.template} | ${s.merchant} | ${amount} | ****${s.card}`);
}

if (showMisses && missSubjects.size) {
    console.log('\nSin match (excluye marketing):');
    for (const [k, n] of [...missSubjects].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${String(n).padStart(3)}  ${k}`);
    }
}
