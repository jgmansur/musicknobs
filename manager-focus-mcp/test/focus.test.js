import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseRelativeDate,
  toNotionDate,
  friendlyDate,
  findTask,
  todayIso,
} from "../src/focus.js";

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe("parseRelativeDate", () => {
  const today = todayIso();

  test("reconoce expresiones básicas en español", () => {
    assert.equal(parseRelativeDate("hoy"), today);
    assert.equal(parseRelativeDate("mañana"), addDays(today, 1));
    assert.equal(parseRelativeDate("manana"), addDays(today, 1));
    assert.equal(parseRelativeDate("pasado mañana"), addDays(today, 2));
    assert.equal(parseRelativeDate("ayer"), addDays(today, -1));
    assert.equal(parseRelativeDate("antier"), addDays(today, -2));
  });

  test("acepta ISO directo sin tocarlo", () => {
    assert.equal(parseRelativeDate("2026-12-25"), "2026-12-25");
  });

  test("entiende 'en N días' y 'en N semanas'", () => {
    assert.equal(parseRelativeDate("en 3 días"), addDays(today, 3));
    assert.equal(parseRelativeDate("en 1 dia"), addDays(today, 1));
    assert.equal(parseRelativeDate("en 2 semanas"), addDays(today, 14));
  });

  test("'próxima semana' son 7 días", () => {
    assert.equal(parseRelativeDate("próxima semana"), addDays(today, 7));
    assert.equal(parseRelativeDate("la siguiente semana"), addDays(today, 7));
  });

  test("un día de la semana cae siempre en el futuro, nunca hoy", () => {
    for (const day of ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]) {
      const result = parseRelativeDate(`el ${day}`);
      assert.ok(result > today, `«el ${day}» debe ser futuro, dio ${result}`);
      const delta = Math.round(
        (new Date(`${result}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000,
      );
      assert.ok(delta >= 1 && delta <= 7, `«el ${day}» debe caer dentro de 7 días, dio ${delta}`);
    }
  });

  test("nunca lanza: lo irreconocible cae en hoy", () => {
    assert.equal(parseRelativeDate("cuando sea"), today);
    assert.equal(parseRelativeDate(""), today);
    assert.equal(parseRelativeDate(null), today);
    assert.equal(parseRelativeDate("2026-13-45"), today);
  });
});

describe("toNotionDate", () => {
  test("ancla a las 09:00 hora de México", () => {
    assert.equal(toNotionDate("2026-08-24"), "2026-08-24T09:00:00-06:00");
  });

  test("el instante resultante sigue cayendo en el día correcto en México", () => {
    const mx = new Date(toNotionDate("2026-08-24")).toLocaleDateString("en-CA", {
      timeZone: "America/Mexico_City",
    });
    assert.equal(mx, "2026-08-24");
  });
});

describe("friendlyDate", () => {
  const today = todayIso();

  test("usa palabras para los días cercanos", () => {
    assert.equal(friendlyDate(today), "hoy");
    assert.equal(friendlyDate(addDays(today, 1)), "mañana");
    assert.equal(friendlyDate(addDays(today, 2)), "pasado mañana");
    assert.equal(friendlyDate(addDays(today, -1)), "ayer");
    assert.equal(friendlyDate(addDays(today, -2)), "antier");
  });

  test("dentro de la semana nombra el día", () => {
    const out = friendlyDate(addDays(today, 4));
    assert.match(out, /^el (lunes|martes|miércoles|jueves|viernes|sábado|domingo) \(\d{2}\/\d{2}\)$/);
  });

  test("más lejos usa fecha completa", () => {
    assert.equal(friendlyDate("2027-03-09"), "09/03/2027");
  });
});

describe("findTask", () => {
  const tasks = [
    { id: "1", title: "Grabar video de compresión" },
    { id: "2", title: "Grabar video de ecualización" },
    { id: "3", title: "Pagar Telcel" },
    { id: "4", title: "Revisar máster de la canción" },
  ];

  test("match exacto gana sobre todo lo demás", () => {
    const { match } = findTask("Pagar Telcel", tasks);
    assert.equal(match.id, "3");
  });

  test("ignora acentos y mayúsculas", () => {
    const { match } = findTask("revisar master de la cancion", tasks);
    assert.equal(match.id, "4");
  });

  test("un solo substring resuelve sin ambigüedad", () => {
    const { match } = findTask("compresión", tasks);
    assert.equal(match.id, "1");
  });

  test("varios substrings NO eligen: devuelven candidatos para preguntar", () => {
    const { match, candidates } = findTask("grabar video", tasks);
    assert.equal(match, null, "no debe adivinar entre dos tareas parecidas");
    assert.equal(candidates.length, 2);
  });

  test("resuelve por todas las palabras aunque estén desordenadas", () => {
    const { match } = findTask("telcel pagar", tasks);
    assert.equal(match.id, "3");
  });

  test("sin coincidencias no inventa nada", () => {
    const { match, candidates } = findTask("comprar tortillas", tasks);
    assert.equal(match, null);
    assert.equal(candidates.length, 0);
  });

  test("lee tanto `title` como `name`", () => {
    const { match } = findTask("mezclar", [{ id: "9", name: "Mezclar el demo" }]);
    assert.equal(match.id, "9");
  });
});
