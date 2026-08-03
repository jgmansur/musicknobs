/**
 * Prueba el MCP como lo usaría un asistente: handshake por stdio, listar
 * herramientas y llamarlas contra la base real. Lo que escribe, lo revierte.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const HERE = dirname(fileURLToPath(import.meta.url));

function envValue(key) {
    for (const line of readFileSync(join(HERE, '..', '.env'), 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i > 0 && t.slice(0, i).trim() === key) return t.slice(i + 1).trim();
    }
}

const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(new StdioClientTransport({
    command: 'node',
    args: [join(HERE, 'src', 'index.js')],
}));

let ok = true;
const check = (label, cond) => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}`);
    if (!cond) ok = false;
};
const call = async (name, args = {}) =>
    (await client.callTool({ name, arguments: args })).content[0].text;

const { tools } = await client.listTools();
console.log(`Herramientas expuestas: ${tools.length}\n`);
for (const t of tools) console.log(`  ${t.name}`);

console.log('\nCONSULTAS\n');
const saldos = await call('finanzas_saldos');
check('finanzas_saldos trae Santander', /Santander/.test(saldos));
check('marca la tarjeta de crédito como deuda', /deuda/.test(saldos));

const fijos = await call('finanzas_fijos_pendientes');
check('finanzas_fijos_pendientes responde', fijos.length > 20);

const pend = await call('finanzas_pendientes', { solo_nuevos: false });
check('finanzas_pendientes lista la bandeja', /pendientes|vacía/.test(pend));

const buckets = await call('finanzas_buckets_planner');
check('expone los 6 buckets', (buckets.match(/\n {2}\S/g) || []).length === 6);

console.log('\nREGLAS DE NEGOCIO\n');
const inexistente = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 100, cuenta: 'Banco Inventado', concepto: 'prueba',
});
check('rechaza una cuenta que no existe', /No existe la cuenta/.test(inexistente));

const sinConcepto = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 100, cuenta: 'Santander', concepto: '   ',
});
check('exige concepto', /Falta el concepto/.test(sinConcepto));

// Ojo: esta llamada SÍ escribe. La regla avisa pero no bloquea, porque un gasto
// real puede tener un concepto que suene a traspaso. Hay que limpiarla.
const CONCEPTO_SOSPECHA = 'PRUEBA MCP traspaso a Hey para fondear';
const sospecha = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 1, cuenta: 'Santander', concepto: CONCEPTO_SOSPECHA,
});
check('avisa cuando huele a transferencia', /Aviso:.*transferencia/s.test(sospecha));

console.log('\nESCRITURA (se revierte)\n');
const sql = postgres(envValue('SUPABASE_DB_URL'), { prepare: false, max: 2 });

const borradas = await sql`
    delete from transactions where description = ${CONCEPTO_SOSPECHA} returning id
`;
check('la prueba del aviso quedó limpia', borradas.length === 1);
const saldoDe = async (n) => {
    const [r] = await sql`select balance from account_balances where name = ${n}`;
    return Number(r.balance);
};

const sAntes = await saldoDe('Santander');
const hAntes = await saldoDe('Hey Banco');
const trans = await call('finanzas_transferencia', {
    origen: 'Santander', destino: 'Hey Banco', monto: 500, concepto: 'PRUEBA MCP',
});
const sDesp = await saldoDe('Santander');
const hDesp = await saldoDe('Hey Banco');

check('la transferencia dice que no es gasto', /No cuenta como gasto/.test(trans));
check('resta del origen', Math.abs(sDesp - sAntes + 500) < 0.01);
check('suma al destino', Math.abs(hDesp - hAntes - 500) < 0.01);

const [{ n: enGasto }] = await sql`
    select count(*)::int as n from transactions
    where description = 'PRUEBA MCP' and kind <> 'transfer'
`;
check('no quedó registrada como gasto', enGasto === 0);

const [{ n: filas }] = await sql`
    select count(*)::int as n from transactions where description = 'PRUEBA MCP'
`;
check('creó las dos filas ligadas', filas === 2);

await sql`delete from transactions where description = 'PRUEBA MCP'`;
check('revertido', Math.abs((await saldoDe('Santander')) - sAntes) < 0.01);

console.log(`\n${ok ? 'TODO CORRECTO' : 'ALGO FALLÓ'}`);
await sql.end();
await client.close();
process.exit(ok ? 0 : 1);
