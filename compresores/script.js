const data = {
  tarola: [
    {
      nombre: "1176",
      descripcion: "Rápido y agresivo, ideal para resaltar transientes en la tarola."
    },
    {
      nombre: "dbx 160",
      descripcion: "Sonido clásico punchy, usado en muchas grabaciones de los 80s y 90s."
    }
  ],
  voz: [
    {
      nombre: "LA-2A",
      descripcion: "Suave y musical, excelente para voces principales."
    },
    {
      nombre: "1176",
      descripcion: "Combinado con un LA-2A es la cadena vocal clásica (1176 ➝ LA-2A)."
    }
  ],
  bajo: [
    {
      nombre: "Teletronix LA-2A",
      descripcion: "Perfecto para bajos sostenidos, suave y cálido."
    },
    {
      nombre: "Empirical Labs Distressor",
      descripcion: "Flexible y moderno, muy usado para bajo en rock y pop actual."
    }
  ],
  batería: [
    {
      nombre: "API 2500",
      descripcion: "Control y pegada con color clásico, ideal para drum bus."
    },
    {
      nombre: "SSL G Bus Compressor",
      descripcion: "El clásico 'glue' en baterías de mezclas noventeras."
    }
  ],
  master: [
    {
      nombre: "Manley Vari-Mu",
      descripcion: "Compresor de mastering con calidez y suavidad."
    },
    {
      nombre: "Shadow Hills Mastering Compressor",
      descripcion: "Famoso por su color, punch y control fino."
    }
  ],
  acústica: [
    {
      nombre: "Tube-Tech CL 1B",
      descripcion: "Muy musical y transparente, ideal para guitarras suaves."
    },
    {
      nombre: "dbx 160",
      descripcion: "Más agresivo, para guitarras con ritmo marcado."
    }
  ]
};

document.getElementById("fuenteSonido").addEventListener("change", function () {
  const valor = this.value;
  const resultado = document.getElementById("resultado");
  resultado.innerHTML = "";

  if (data[valor]) {
    const lista = document.createElement("ul");
    data[valor].forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${item.nombre}</strong>: ${item.descripcion}`;
      lista.appendChild(li);
    });
    resultado.appendChild(lista);
  }
});
