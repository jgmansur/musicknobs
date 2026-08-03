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

// Certeza: el concepto nombra otra cuenta propia. Debe BLOQUEAR sin escribir.
const bloqueado = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 1, cuenta: 'Santander',
    concepto: 'PRUEBA MCP traspaso a Hey Banco',
});
check('bloquea la transferencia con destino identificado', /NO se registró/.test(bloqueado));

const bloqueadoExplicito = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 1, cuenta: 'Santander', concepto: 'PRUEBA MCP',
    destino: 'BBVA',
});
check('bloquea cuando el destino se declara', /NO se registró/.test(bloqueadoExplicito));

// Sospecha: suena a traspaso pero no identifica destino. Registra y advierte,
// porque un gasto real puede llamarse así. Esta llamada SÍ escribe.
const CONCEPTO_SOSPECHA = 'PRUEBA MCP traspaso de mercancia';
const sospecha = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 1, cuenta: 'Santander', concepto: CONCEPTO_SOSPECHA,
});
check('advierte pero registra cuando solo hay sospecha', /Aviso:.*transferencia/s.test(sospecha));

const ambigua = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 1, cuenta: 'an', concepto: 'PRUEBA MCP ambigua',
});
check('no elige entre cuentas ambiguas', /no voy a elegir por ti/.test(ambigua));

const inventado = await call('finanzas_pagar_fijo', { concepto: 'Escuela', cuenta: 'Santander' });
check('no elige entre gastos fijos ambiguos', /no voy a elegir por ti/.test(inventado));

console.log('\nESCRITURA (se revierte)\n');
const sql = postgres(envValue('SUPABASE_DB_URL'), { prepare: false, max: 2 });

const borradas = await sql`
    delete from transactions where description like 'PRUEBA MCP%' returning id
`;
check('solo se escribió el caso de sospecha', borradas.length === 1);

console.log('\nIDEMPOTENCIA\n');
const clave = 'prueba-idempotencia-001';
const uno = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 33, cuenta: 'Santander', concepto: 'PRUEBA IDEM',
    idempotency_key: clave,
});
const dos = await call('finanzas_registrar_movimiento', {
    tipo: 'gasto', monto: 33, cuenta: 'Santander', concepto: 'PRUEBA IDEM',
    idempotency_key: clave,
});
check('el primer intento registra', /Registrado/.test(uno));
check('el reintento no duplica', /ya estaba registrado/.test(dos));
const idemRows = await sql`select id from transactions where description = 'PRUEBA IDEM'`;
check('quedó una sola fila', idemRows.length === 1);
await sql`delete from transactions where description = 'PRUEBA IDEM'`;

console.log('\nRECONCILIACIÓN PROTEGIDA\n');
const [antesRec] = await sql`select display_balance from account_balances where name = 'Santander'`;
const saldoActual = Number(antesRec.display_balance);

const abortado = await call('finanzas_ajustar_saldo', {
    cuenta: 'Santander', saldo_real: 5000, saldo_esperado: saldoActual + 999,
});
check('aborta si el saldo esperado no coincide', /Abortado/.test(abortado));

const simulado = await call('finanzas_ajustar_saldo', {
    cuenta: 'Santander', saldo_real: 5000, dry_run: true,
});
check('dry_run no escribe', /Simulación/.test(simulado));
const [trasDry] = await sql`select display_balance from account_balances where name = 'Santander'`;
check('el saldo sigue igual tras dry_run', Math.abs(Number(trasDry.display_balance) - saldoActual) < 0.01);

const aplicado = await call('finanzas_ajustar_saldo', {
    cuenta: 'Santander', saldo_real: 1234.56, saldo_esperado: saldoActual,
    motivo: 'PRUEBA MCP reconciliación',
});
check('reancla cuando el esperado coincide', /reanclada/.test(aplicado));

const bitacora = await call('finanzas_historial_ajustes', { cuenta: 'Santander' });
check('el reanclaje quedó en bitácora', /PRUEBA MCP reconciliación/.test(bitacora));

// Restaurar el saldo real de Jay y borrar el rastro de la prueba.
await sql`update accounts set opening_balance = ${saldoActual}, opening_balance_at = now()
          where name = 'Santander'`;
await sql`delete from balance_adjustments where motivo = 'PRUEBA MCP reconciliación'`;
const [restaurado] = await sql`select display_balance from account_balances where name = 'Santander'`;
check('saldo restaurado', Math.abs(Number(restaurado.display_balance) - saldoActual) < 0.01);
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


console.log('\nCICLO DE VIDA (fase 2)\n');

const catalogo = await call('finanzas_categorias', { meses: 12 });
check('finanzas_categorias responde', /Categorías de los últimos/.test(catalogo));

const sinCat = await call('finanzas_sin_categoria', { limite: 5 });
check('finanzas_sin_categoria responde', /Comercios sin categoría|Todo está categorizado/.test(sinCat));

// Categorización masiva sobre un movimiento propio, para no tocar datos reales.
const [creado] = await sql`
    insert into transactions (occurred_at, account_id, amount, kind, merchant, description, source)
    select now(), id, -77, 'gasto', 'PRUEBA COMERCIO F2', 'PRUEBA F2', 'script'
    from accounts where name = 'Santander' returning id
`;
const simCat = await call('finanzas_categorizar_comercio', {
    comercio: 'PRUEBA COMERCIO F2', categoria: 'Prueba', dry_run: true,
});
check('categorizar en seco no escribe', /Simulación: 1 movimientos/.test(simCat));
const [sigueNull] = await sql`select category from transactions where id = ${creado.id}`;
check('la categoría sigue vacía tras el dry_run', sigueNull.category === null);

const aplicaCat = await call('finanzas_categorizar_comercio', {
    comercio: 'PRUEBA COMERCIO F2', categoria: 'Prueba',
});
check('categorizar aplica', /1 movimientos.*categorizados/.test(aplicaCat));
const [conCat] = await sql`select category from transactions where id = ${creado.id}`;
check('la categoría quedó guardada', conCat.category === 'Prueba');

const editado = await call('finanzas_editar_movimiento', {
    id: creado.id, monto: 99, concepto: 'PRUEBA F2 EDITADA',
});
check('editar responde', /actualizado/.test(editado));
const [trasEdit] = await sql`select amount, description from transactions where id = ${creado.id}`;
check('el monto se editó conservando el signo', Math.abs(Number(trasEdit.amount) + 99) < 0.01);
check('el concepto se editó', trasEdit.description === 'PRUEBA F2 EDITADA');

const revertido = await call('finanzas_revertir_movimiento', { id: creado.id });
check('revertir responde', /Revertido/.test(revertido));
const quedan = await sql`select id from transactions where id = ${creado.id}`;
check('el movimiento ya no existe', quedan.length === 0);

// Aprobar y revertir un pendiente real: debe volver a la bandeja.
const [pendiente] = await sql`
    select p.id, p.merchant from pending_transactions p
    join accounts a on a.id = p.suggested_account_id
    where p.status = 'pending' and p.amount is not null
    order by p.occurred_at desc limit 1
`;
if (pendiente) {
    const apr = await call('finanzas_aprobar_pendiente', { id: pendiente.id });
    check('aprobar pendiente responde', /Aprobado/.test(apr));
    const [tras] = await sql`select status, transaction_id from pending_transactions where id = ${pendiente.id}`;
    check('el pendiente quedó aprobado', tras.status === 'approved');

    const rev = await call('finanzas_revertir_movimiento', { id: tras.transaction_id });
    check('revertir el movimiento del pendiente', /Revertido/.test(rev));
    const [vuelta] = await sql`select status from pending_transactions where id = ${pendiente.id}`;
    check('el pendiente regresó a la bandeja', vuelta.status === 'pending');
} else {
    console.log('  (sin pendientes con monto para probar)');
}


console.log('\nREGLAS DE CATEGORÍA (fase 3)\n');

// Se trabaja sobre movimientos propios para no tocar el histórico de Jay.
const inventados = await sql`
    insert into transactions (occurred_at, account_id, amount, kind, merchant, description, source)
    select now() - (n || ' days')::interval, a.id, -50, 'gasto',
           'PRUEBA CAFETERIA F3', 'PRUEBA F3', 'script'
    from accounts a, generate_series(1, 4) n where a.name = 'Santander'
    returning id
`;
check('se crearon movimientos de prueba', inventados.length === 4);

const sim = await call('finanzas_crear_regla_categoria', {
    patron: 'PRUEBA CAFETERIA F3', categoria: 'Cafeterías', dry_run: true,
});
check('crear regla en seco reporta el alcance', /categorizaría 4 movimientos/.test(sim));
const [sinTocar] = await sql`select category from transactions where id = ${inventados[0].id}`;
check('el dry_run no categorizó nada', sinTocar.category === null);

const creada = await call('finanzas_crear_regla_categoria', {
    patron: 'PRUEBA CAFETERIA F3', categoria: 'Cafeterías',
});
check('la regla se crea y aplica al histórico', /se categorizaron 4 movimientos/.test(creada));
const categorizados = await sql`
    select count(*)::int as n from transactions
    where id in ${sql(inventados.map((r) => r.id))} and category = 'Cafeterías'
`;
check('los 4 quedaron categorizados', categorizados[0].n === 4);

const dup = await call('finanzas_crear_regla_categoria', {
    patron: 'prueba cafeteria f3', categoria: 'Otra',
});
check('no permite dos categorías para el mismo patrón', /Ya existe una regla/.test(dup));

const listado = await call('finanzas_reglas_categoria');
check('la regla aparece listada', /PRUEBA CAFETERIA F3/.test(listado));

// La ingesta usa el mismo matcher: se verifica directo sobre el módulo compartido.
const { categoriaPara } = await import('../shared/categorias.js');
const reglasVivas = await sql`select patron, categoria, prioridad from category_rules`;
const hit = categoriaPara({ merchant: 'compra en PRUEBA CAFETERIA F3 centro' }, reglasVivas);
check('el matcher de la ingesta encuentra la misma regla', hit?.categoria === 'Cafeterías');

const borrada = await call('finanzas_borrar_regla_categoria', { patron: 'PRUEBA CAFETERIA F3' });
check('la regla se borra', /Regla borrada/.test(borrada));
const trasBorrar = await sql`
    select count(*)::int as n from transactions
    where id in ${sql(inventados.map((r) => r.id))} and category = 'Cafeterías'
`;
check('borrar la regla no descategoriza el histórico', trasBorrar[0].n === 4);

await sql`delete from transactions where description = 'PRUEBA F3'`;
await sql`delete from category_rules where patron ilike 'PRUEBA%'`;

const propuestas = await call('finanzas_aprender_reglas', { minimo: 3 });
// Hoy no hay nada categorizado, así que debe decirlo con claridad y sugerir
// por dónde empezar, no devolver un "no encontré nada" que no explica nada.
check('aprender reglas explica por qué no propone',
    /reglas propuestas|No hay nada que aprender|ningún comercio se repite/.test(propuestas));

const vocab = await call('finanzas_categorias', { meses: 12 });
check('expone el vocabulario de categorías de los fijos',
    /gastos fijos y aquí no aparecen/.test(vocab));

console.log(`\n${ok ? 'TODO CORRECTO' : 'ALGO FALLÓ'}`);
await sql.end();
await client.close();
process.exit(ok ? 0 : 1);
