const canvas = document.getElementById('canvas');
const toolbar = document.querySelector('.tool-groups');

let elementCount = 0;

const svgNS = 'http://www.w3.org/2000/svg';

// Petita drecera per crear un element SVG amb uns atributs donats
function svgEl(tag, attrs) {
  const el = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

// Estil "de línia" compartit per totes les formes: traç fi i monocrom,
// sense colors identificatius per tipus (com en un plànol d'enginyeria,
// on la forma diferencia l'element, no el color). El color queda reservat
// als accents que marquen una part activa (fletxa de flux, rotor...).
const LINE_STROKE = '#c7d1dc';
const LINE_FILL = '#141a22';
const LINE_WIDTH = 1.25;
const DETAIL_WIDTH = 1;
const ACCENT = '#38bdf8';

function shapeAttrs(extra) {
  return { fill: LINE_FILL, stroke: LINE_STROKE, 'stroke-width': LINE_WIDTH, ...extra };
}

function lineAttrs(extra) {
  return { stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH, ...extra };
}

// Plantilles esquemàtiques per a cada tipus d'element, dibuixades a mà
// seguint l'esbós de referència. Cada plantilla dibuixa la forma dins una
// capsa local que comença a (0,0); l'entrada és sempre el punt marcat a
// l'esquerra o a dalt de la forma, i la sortida el de la dreta o a baix.
const templates = {
  pump: () => {
    const g = createGroup('pump');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 0, width: 60, height: 60 })));
    g.appendChild(svgEl('circle', shapeAttrs({ cx: 42, cy: 30, r: 13 })));
    g.appendChild(svgEl('polygon', { points: '36,23 36,37 50,30', fill: ACCENT }));
    return g;
  },
  valve: () => {
    const g = createGroup('valve');
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '0,0 20,20 0,40' })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '40,0 20,20 40,40' })));
    return g;
  },
  hopper: () => {
    const g = createGroup('hopper');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 20, y: 0, width: 20, height: 15 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 15, width: 60, height: 50 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '0,65 60,65 30,90' })));
    return g;
  },
  airlock: () => {
    const g = createGroup('airlock');
    g.appendChild(svgEl('circle', shapeAttrs({ cx: 25, cy: 25, r: 22 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 3, y1: 25, x2: 47, y2: 25 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 25, y1: 3, x2: 25, y2: 47 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 9.4, y1: 9.4, x2: 40.6, y2: 40.6 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 9.4, y1: 40.6, x2: 40.6, y2: 9.4 })));
    g.appendChild(svgEl('circle', { cx: 25, cy: 25, r: 4, fill: ACCENT }));
    return g;
  },
  filter: () => {
    const g = createGroup('filter');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 20, y: 0, width: 20, height: 12 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 12, width: 60, height: 50 })));
    g.appendChild(svgEl('polyline', {
      points: '45,62 45,75 60,75', fill: 'none', stroke: LINE_STROKE, 'stroke-width': LINE_WIDTH,
    }));
    return g;
  },
  cyclone: () => {
    const g = createGroup('cyclone');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 0, width: 15, height: 12 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 15, y: 0, width: 35, height: 40 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '15,40 50,40 32.5,80' })));
    return g;
  },
  screwfeeder: () => {
    const g = createGroup('screwfeeder');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 5, width: 100, height: 25 })));
    [10, 28, 46, 64, 82].forEach((x) => {
      g.appendChild(svgEl('line', lineAttrs({ x1: x, y1: 8, x2: x + 14, y2: 27 })));
    });
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '75,30 90,30 82,40' })));
    return g;
  },
  bagdump: () => {
    const g = createGroup('bagdump');
    g.appendChild(svgEl('line', lineAttrs({ x1: 10, y1: 20, x2: 0, y2: 5 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '10,20 50,20 50,45 30,65 10,45' })));
    return g;
  },
  injector: () => {
    const g = createGroup('injector');
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '0,0 17,15 35,3 53,15 70,0 70,30 0,30' })));
    return g;
  },
};

// Posició (en coordenades locals de l'element) dels punts de connexió
// d'entrada i sortida de cada tipus d'element connectable. L'entrada és
// sempre el punt de l'esquerra o de dalt, i la sortida el de la dreta o
// de baix, tal com marca l'esbós de referència per a cada forma.
const connectionOffsets = {
  pump: { input: { x: 0, y: 30 }, output: { x: 60, y: 30 } },
  valve: { input: { x: 0, y: 20 }, output: { x: 40, y: 20 } },
  hopper: { input: { x: 30, y: 0 }, output: { x: 30, y: 90 } },
  airlock: { input: { x: 25, y: 3 }, output: { x: 25, y: 47 } },
  filter: { input: { x: 30, y: 0 }, output: { x: 60, y: 75 } },
  cyclone: { input: { x: 0, y: 6 }, output: { x: 32.5, y: 80 } },
  screwfeeder: { input: { x: 0, y: 5 }, output: { x: 100, y: 30 } },
  bagdump: { input: { x: 0, y: 5 }, output: { x: 30, y: 65 } },
  injector: { input: { x: 0, y: 15 }, output: { x: 70, y: 15 } },
};

function createGroup(type) {
  const g = document.createElementNS(svgNS, 'g');
  g.classList.add('pid-element');
  g.dataset.type = type;
  return g;
}

// Dibuixa els punts d'entrada i sortida d'un element connectable. Cada
// punt és un únic cercle ple (no un contorn): amb un fill sòlid, tot el
// disc respon al clic, no només la vora.
function addConnectionPoints(element, type) {
  const offsets = connectionOffsets[type];
  if (!offsets) return;

  Object.entries(offsets).forEach(([role, pos]) => {
    const point = document.createElementNS(svgNS, 'circle');
    point.setAttribute('cx', pos.x);
    point.setAttribute('cy', pos.y);
    point.setAttribute('r', 9);
    point.classList.add('connection-point', `connection-point--${role}`);
    point.dataset.role = role;
    element.appendChild(point);
  });
}

// Afegeix un element nou al centre aproximat del canvas
function addElement(type) {
  const build = templates[type];
  if (!build) return;

  const g = build();
  elementCount += 1;
  g.dataset.id = `${type}-${elementCount}`;

  const x = 40 + (elementCount * 15) % 300;
  const y = 40 + (elementCount * 25) % 200;
  g.setAttribute('transform', `translate(${x}, ${y})`);

  addConnectionPoints(g, type);
  makeDraggable(g);
  makeConnectable(g);
  canvas.appendChild(g);
}

// Permet arrossegar un element (dipòsit, bomba o vàlvula) dins el canvas
function makeDraggable(element) {
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;

  element.addEventListener('mousedown', (event) => {
    dragging = true;
    const transform = element.transform.baseVal.getItem(0);
    offsetX = event.clientX - transform.matrix.e;
    offsetY = event.clientY - transform.matrix.f;
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    const x = event.clientX - offsetX;
    const y = event.clientY - offsetY;
    element.setAttribute('transform', `translate(${x}, ${y})`);
    updateConnectedPipes(element);
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
}

// ---- Sistema de canonades (connectors entre elements) ----
// Cada canonada es representa amb un camí ortogonal de 4 punts: el punt
// d'origen (A), dos punts intermedis que comparteixen la mateixa X (que
// formen el tram vertical) i el punt de destí (B). La posició d'aquest
// tram vertical es guarda com una proporció (`ratio`) entre A i B, de
// manera que si es mou un element connectat, el camí es recalcula
// mantenint l'ajust que hagi fet l'usuari.
const pipes = [];
let pendingPipe = null;

function getTranslate(element) {
  const transform = element.transform.baseVal.getItem(0);
  return { x: transform.matrix.e, y: transform.matrix.f };
}

function getConnectionPointPosition(element, role) {
  const offset = connectionOffsets[element.dataset.type][role];
  const translate = getTranslate(element);
  return { x: translate.x + offset.x, y: translate.y + offset.y };
}

// Un punt de connexió (element + rol) només pot formar part d'una canonada
function isPointConnected(element, role) {
  return pipes.some((pipe) => (
    (pipe.from.element === element && pipe.from.point === role)
    || (pipe.to.element === element && pipe.to.point === role)
  ));
}

// Marca visualment els punts d'un element com a connectats o lliures
function updatePointConnectedState(element) {
  element.querySelectorAll('.connection-point').forEach((point) => {
    const connected = isPointConnected(element, point.dataset.role);
    point.classList.toggle('connection-point--connected', connected);
  });
}

function pipePath(a, b, midX) {
  const points = [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

// Recalcula el traçat d'una canonada a partir de la posició actual dels
// elements que connecta i de la proporció (`ratio`) del seu tram vertical
function updatePipe(pipe) {
  const a = getConnectionPointPosition(pipe.from.element, pipe.from.point);
  const b = getConnectionPointPosition(pipe.to.element, pipe.to.point);
  const midX = a.x + pipe.ratio * (b.x - a.x);

  pipe.path.setAttribute('d', pipePath(a, b, midX));
  pipe.handle.setAttribute('cx', midX);
  pipe.handle.setAttribute('cy', (a.y + b.y) / 2);
}

// Actualitza totes les canonades connectades a un element que s'acaba de moure
function updateConnectedPipes(element) {
  pipes
    .filter((pipe) => pipe.from.element === element || pipe.to.element === element)
    .forEach(updatePipe);
}

// Crea una canonada real entre dos punts de connexió de dos elements diferents
function createPipe(fromElement, fromRole, toElement, toRole) {
  const group = document.createElementNS(svgNS, 'g');
  group.classList.add('pid-element', 'pipe');
  group.dataset.type = 'pipe';

  const path = document.createElementNS(svgNS, 'path');
  path.classList.add('pipe-path');

  const handle = document.createElementNS(svgNS, 'circle');
  handle.classList.add('pipe-handle');
  handle.setAttribute('r', 4);

  group.appendChild(path);
  group.appendChild(handle);
  canvas.prepend(group);

  const pipe = {
    from: { element: fromElement, point: fromRole },
    to: { element: toElement, point: toRole },
    ratio: 0.5,
    group,
    path,
    handle,
  };

  pipes.push(pipe);
  updatePipe(pipe);
  makeHandleDraggable(pipe);
  updatePointConnectedState(fromElement);
  updatePointConnectedState(toElement);
}

// Permet arrossegar el punt intermedi d'una canonada per ajustar-ne el recorregut
function makeHandleDraggable(pipe) {
  let dragging = false;

  pipe.handle.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    dragging = true;
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    const a = getConnectionPointPosition(pipe.from.element, pipe.from.point);
    const b = getConnectionPointPosition(pipe.to.element, pipe.to.point);
    if (a.x === b.x) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const ratio = (mouseX - a.x) / (b.x - a.x);
    pipe.ratio = Math.min(0.95, Math.max(0.05, ratio));
    updatePipe(pipe);
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
}

// Permet iniciar la creació d'una canonada arrossegant des d'un punt de connexió
function makeConnectable(element) {
  element.querySelectorAll('.connection-point').forEach((point) => {
    point.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      if (isPointConnected(element, point.dataset.role)) return;

      const previewPath = document.createElementNS(svgNS, 'path');
      previewPath.classList.add('pipe-path', 'pipe-path--preview');
      canvas.appendChild(previewPath);
      pendingPipe = { fromElement: element, fromRole: point.dataset.role, previewPath };
    });
  });
}

window.addEventListener('mousemove', (event) => {
  if (!pendingPipe) return;
  const a = getConnectionPointPosition(pendingPipe.fromElement, pendingPipe.fromRole);
  const rect = canvas.getBoundingClientRect();
  const b = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const midX = a.x + (b.x - a.x) / 2;
  pendingPipe.previewPath.setAttribute('d', pipePath(a, b, midX));
});

window.addEventListener('mouseup', (event) => {
  if (!pendingPipe) return;

  const targetUnderCursor = document.elementFromPoint(event.clientX, event.clientY);
  const targetPoint = targetUnderCursor && targetUnderCursor.closest('.connection-point');
  const targetElement = targetPoint && targetPoint.closest('.pid-element');
  const targetRole = targetPoint && targetPoint.dataset.role;

  if (
    targetElement
    && targetElement !== pendingPipe.fromElement
    && !isPointConnected(targetElement, targetRole)
  ) {
    createPipe(pendingPipe.fromElement, pendingPipe.fromRole, targetElement, targetRole);
  }

  pendingPipe.previewPath.remove();
  pendingPipe = null;
});

// Connecta els botons de la barra d'eines amb la creació d'elements
toolbar.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tool]');
  if (!button) return;
  addElement(button.dataset.tool);
});

// ---- Menú contextual ----
// Llista d'opcions del menú: cada entrada té una etiqueta i una acció a
// executar sobre l'element clicat. Afegir noves opcions en el futur és
// tan senzill com afegir un nou objecte a aquest array.
const contextMenuItems = [
  {
    label: 'Eliminar element',
    action: (element) => removeElement(element),
  },
];

// Elimina un element del canvas. Si és un dipòsit, bomba o vàlvula,
// també elimina qualsevol canonada que hi estigui connectada perquè
// no en quedi cap despenjada.
function removeElement(element) {
  if (element.dataset.type === 'pipe') {
    removePipe(element);
    return;
  }

  pipes
    .filter((pipe) => pipe.from.element === element || pipe.to.element === element)
    .forEach(removePipe);

  element.remove();
}

function removePipe(pipeGroupOrPipe) {
  const pipe = pipes.find((p) => p.group === pipeGroupOrPipe) || pipeGroupOrPipe;
  const index = pipes.indexOf(pipe);
  if (index !== -1) pipes.splice(index, 1);
  pipe.group.remove();
  updatePointConnectedState(pipe.from.element);
  updatePointConnectedState(pipe.to.element);
}

let activeContextMenu = null;

function closeContextMenu() {
  if (!activeContextMenu) return;
  activeContextMenu.remove();
  activeContextMenu = null;
}

function openContextMenu(x, y, element) {
  closeContextMenu();

  const menu = document.createElement('ul');
  menu.className = 'context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  contextMenuItems.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.label;
    li.addEventListener('click', (event) => {
      event.stopPropagation();
      item.action(element);
      closeContextMenu();
    });
    menu.appendChild(li);
  });

  document.body.appendChild(menu);
  activeContextMenu = menu;
}

// Mostra el menú contextual en fer clic dret sobre un element del canvas
// i evita que aparegui el menú per defecte del navegador.
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const target = event.target.closest('.pid-element');
  if (target) {
    openContextMenu(event.clientX, event.clientY, target);
  } else {
    closeContextMenu();
  }
});

// Tanca el menú contextual en clicar a qualsevol altre lloc de la pantalla
window.addEventListener('click', closeContextMenu);
