import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const sync=source.slice(source.indexOf('async function financeCoreSync('),source.indexOf('\n\n/* ===',source.indexOf('async function financeCoreSync(')));
const save=source.slice(source.indexOf('async function gastos_guardar()'),source.indexOf('\nfunction gastos_cancelar()',source.indexOf('async function gastos_guardar()')));
function fixture(options={}) {
  const fields={
    'g-btn-save':{disabled:false,innerText:'GUARDAR'},'g-status':{innerText:'',style:{}},
    'g-lugar':{value:'Fixture shop'},'g-monto':{value:'20'},'g-id-fila':{value:''},
    'g-currency':{value:'MXN'},'g-forma-pago':{value:'Fixture bank'},
    'g-concepto':{value:'Fixture concept'},'g-tipo':{value:'Gasto'},'g-fotos-input':{files:options.files||[]},
  };
  const calls={post:0,sheets:0,cancel:0,refresh:0,upload:0,history:0};
  const context=vm.createContext({
    console:{warn(){},error(){}},Date,document:{getElementById:id=>fields[id]},
    balanceDesdeWorker:!options.noToken,balanceAccounts:options.accounts||[{id:'fixture-account',name:'Fixture bank'}],
    bandeja_token:()=>options.noToken?'':'fixture-token',
    balance_getAccountMatchKeys:a=>[a.name],balance_normalizePaymentKey:x=>x,
    bandeja_api:async()=>{calls.post++;if(options.networkError)throw Error('fixture response lost');return options.response||{ok:true,id:'fixture-transaction'};},
    balance_loadFromWorker:async()=>{calls.refresh++;if(options.refreshError)throw Error('fixture refresh failed');return !options.refreshFalse && !options.noToken;},
    balance_updateKpi(){},parseCurrencyCode:x=>x,normalizeTipo:x=>x,parseSheetValue:Number,
    showToast(){},gastosState:{saveState:'idle'},esIdDeWorker:()=>false,
    sheetsAppend:async()=>{calls.sheets++;},sheetsUpdate:async()=>{calls.sheets++;},
    driveFindFolder:async()=>'fixture-folder',driveUploadFile:async()=>{calls.upload++;if(calls.upload===2)throw Error('fixture upload failed');return 'fixture-receipt-url';},
    gastos_cancelar:()=>{calls.cancel++;fields['g-lugar'].value='';fields['g-btn-save'].disabled=false;},
    gastos_cargarHistorial:()=>{calls.history++;},
  });
  vm.runInContext('function gastos_guardadoEnCurso(){return gastosState.saveState===\"sending\"||gastosState.saveState===\"pending\";}\n'+sync+'\n'+save,context);
  return {context,calls,fields,run:()=>vm.runInContext('gastos_guardar()',context)};
}
test('unavailable session is failed and preserves form without POST or Sheets write',async()=>{
  const f=fixture({noToken:true});await f.run();assert.equal(f.calls.post,0);assert.equal(f.calls.sheets,0);assert.equal(f.calls.cancel,0);assert.match(f.fields['g-status'].innerText,/No se envió/);assert.equal(f.fields['g-btn-save'].disabled,false);
});
test('ambiguous account is failed before POST',async()=>{
  const f=fixture({accounts:[{id:'a',name:'Fixture bank'},{id:'b',name:'Fixture bank'}]});await f.run();assert.equal(f.calls.post,0);assert.equal(f.calls.cancel,0);assert.match(f.fields['g-status'].innerText,/ambigüedad/);
});
test('lost response is pending, preserves form and blocks another submission',async()=>{
  const f=fixture({networkError:true});await f.run();await f.run();assert.equal(f.calls.post,1);assert.equal(f.calls.sheets,0);assert.equal(f.calls.cancel,0);assert.equal(f.fields['g-lugar'].value,'Fixture shop');assert.equal(f.fields['g-btn-save'].disabled,true);assert.match(f.fields['g-status'].innerText,/sin confirmar/);
});
test('malformed success response is pending',async()=>{
  const f=fixture({response:{ok:true}});await f.run();assert.equal(f.calls.cancel,0);assert.equal(f.fields['g-btn-save'].disabled,true);assert.match(f.fields['g-status'].innerText,/no confirmó/);
});
test('confirmed write plus thrown balance refresh is partial confirmation, never reposted',async()=>{
  const f=fixture({refreshError:true});await f.run();assert.equal(f.calls.post,1);assert.equal(f.calls.cancel,1);assert.match(f.fields['g-status'].innerText,/Movimiento guardado.*saldo pendiente/);assert.equal(f.calls.sheets,0);
});
test('confirmed write plus false balance refresh is also partial confirmation',async()=>{
  const f=fixture({refreshFalse:true});await f.run();assert.equal(f.calls.post,1);assert.match(f.fields['g-status'].innerText,/no vuelvas a registrar/);
});
test('confirmed success is the only path that clears form with success',async()=>{
  const f=fixture();await f.run();assert.equal(f.calls.post,1);assert.equal(f.calls.cancel,1);assert.match(f.fields['g-status'].innerText,/✅ Guardado/);assert.equal(f.calls.sheets,0);
});
test('partial receipt upload retains successful receipt and reports incomplete attachments',async()=>{
  const f=fixture({files:[{},{}]});await f.run();assert.equal(f.calls.upload,2);assert.equal(f.calls.post,1);assert.equal(f.calls.cancel,1);assert.match(f.fields['g-status'].innerText,/algunos recibos no se pudieron adjuntar/);
});
test('retry after a pre-send failure sends once after correction',async()=>{
  const f=fixture({accounts:[]});await f.run();f.context.balanceAccounts=[{id:'fixture-account',name:'Fixture bank'}];await f.run();assert.equal(f.calls.post,1);assert.equal(f.calls.sheets,0);assert.equal(f.calls.cancel,1);
});

test('current session recovery can reconnect before the only POST',async()=>{
  const f=fixture();f.context.balanceDesdeWorker=false;
  f.context.balance_loadFromWorker=async()=>{f.calls.refresh++;f.context.balanceDesdeWorker=true;return true;};
  await f.run();assert.equal(f.calls.post,1);assert.equal(f.calls.cancel,1);assert.equal(f.calls.sheets,0);
});
test('thrown session preflight fails without attempting any write',async()=>{
  const f=fixture();f.context.balanceDesdeWorker=false;
  f.context.balance_loadFromWorker=async()=>{throw Error('fixture session unavailable');};
  await f.run();assert.equal(f.calls.post,0);assert.equal(f.calls.sheets,0);assert.equal(f.calls.cancel,0);assert.equal(f.fields['g-btn-save'].disabled,false);
});
