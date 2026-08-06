/**
 * Cómo distinguir un registro de finance-core de uno de las hojas viejas.
 *
 * finance-core usa UUID; las hojas usan número de fila. Mientras convivan las
 * dos fuentes, cada guardado tiene que decidir a dónde va — y esa decisión debe
 * salir del id MISMO, no de un estado paralelo.
 *
 * Nació de un bug concreto: al editar un gasto, el guard preguntaba por
 * `gastosState.detailRow?.id`, pero `gastos_cerrarModal()` ponía ese estado en
 * `null` justo antes de guardar. El id seguía bien en el formulario; lo que
 * fallaba era la variable consultada. Resultado: todo caía en la rama de Sheets
 * y armaba el rango `Hoja 1!B<uuid>:I<uuid>`, que la API rechaza con
 * "Unable to parse range". Editar un gasto fallaba el 100% de las veces.
 *
 * OJO: esta lógica está duplicada en `finance-dashboard/main.js`. Vercel
 * despliega esa carpeta como raíz, así que no puede importar de aquí sin
 * romper el build. Si tocas una copia, toca la otra.
 */

/** UUID v4 canónico, que es lo que genera `gen_random_uuid()` en Postgres. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Este id pertenece a finance-core?
 *
 * Se exige el formato completo y no "que traiga un guion": `2026-08-06` y
 * `fila-3` traen guion y no son UUID. Darlos por buenos mandaría la petición a
 * un endpoint que responde 404 en vez de escribir donde debe.
 */
export function esIdDeWorker(id) {
    return UUID.test(String(id ?? '').trim());
}
