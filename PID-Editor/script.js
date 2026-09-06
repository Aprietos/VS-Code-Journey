const canvas = document.getElementById('canvas');
const canvasContainer = document.getElementById('canvas-container');
const toolbar = document.querySelector('.tool-groups');
const clearAllButton = document.getElementById('clear-all');

let elementCount = 0;

const svgNS = 'http://www.w3.org/2000/svg';

// ---- Vista (pan i zoom) ----
// Tots els elements i canonades pengen d'aquest grup, no directament del
// <svg>: aplicant-hi un únic transform (translate + scale) es pot desplaçar
// i ampliar/reduir tot el contingut sense haver de tocar cap element.
const viewport = document.createElementNS(svgNS, 'g');
viewport.id = 'viewport';
canvas.appendChild(viewport);

let viewX = 0;
let viewY = 0;
let viewScale = 1;

const MIN_VIEW_SCALE = 0.2;
const MAX_VIEW_SCALE = 4;
const GRID_SIZE = 20;

function applyViewport() {
  viewport.setAttribute('transform', `translate(${viewX}, ${viewY}) scale(${viewScale})`);
  // La quadrícula de fons és CSS, no SVG: cal moure-la/escalar-la a mà
  // perquè continuï alineada amb el contingut.
  const size = GRID_SIZE * viewScale;
  canvasContainer.style.backgroundSize = `${size}px ${size}px`;
  canvasContainer.style.backgroundPosition = `${viewX}px ${viewY}px`;
}

// Converteix coordenades de pantalla (event.clientX/Y) a coordenades de
// món (el sistema on viuen translate/rotate/scale dels elements), desfent
// el pan i el zoom actuals de la vista.
function clientToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewX) / viewScale,
    y: (clientY - rect.top - viewY) / viewScale,
  };
}

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
const LINE_STROKE = '#3d3830';
const LINE_FILL = '#ffffff';
const LINE_WIDTH = 1.25;
const DETAIL_WIDTH = 1;
const ACCENT = '#d97757';

function shapeAttrs(extra) {
  return { fill: LINE_FILL, stroke: LINE_STROKE, 'stroke-width': LINE_WIDTH, ...extra };
}

function lineAttrs(extra) {
  return { stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH, ...extra };
}

// Plantilles esquemàtiques per a cada tipus d'element, redibuixades a partir
// de les imatges de referència de reference-images/. Cada plantilla dibuixa
// la forma dins una capsa local que comença aproximadament a (0,0). Alguns
// elements tenen més d'una entrada o sortida (input2, output2...); el rol
// determina el color del punt (vegeu styles.css) i on es pot connectar.
const templates = {
  pump: () => {
    const g = createGroup('pump');
    g.appendChild(svgEl('circle', shapeAttrs({ cx: 45, cy: 45, r: 40 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 13, y1: 17, x2: 85, y2: 45 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 13, y1: 73, x2: 85, y2: 45 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 85, y1: 45, x2: 98, y2: 45 })));
    return g;
  },
  valve: () => {
    const g = createGroup('valve');
    // Traç doblat respecte a la resta de l'aplicació (2x DETAIL_WIDTH/LINE_WIDTH),
    // exclusiu d'aquest element.
    const w = DETAIL_WIDTH * 2;
    const sw = LINE_WIDTH * 2;
    g.appendChild(svgEl('line', { x1: 45, y1: 0, x2: 45, y2: 30, stroke: LINE_STROKE, 'stroke-width': w }));
    g.appendChild(svgEl('polygon', {
      points: '15,30 75,30 45,90', fill: LINE_FILL, stroke: LINE_STROKE, 'stroke-width': sw,
    }));
    g.appendChild(svgEl('polygon', {
      points: '15,150 75,150 45,90', fill: LINE_FILL, stroke: LINE_STROKE, 'stroke-width': sw,
    }));
    g.appendChild(svgEl('line', { x1: 45, y1: 150, x2: 45, y2: 180, stroke: LINE_STROKE, 'stroke-width': w }));
    g.appendChild(svgEl('circle', { cx: 45, cy: 90, r: 7, fill: LINE_STROKE }));
    g.appendChild(svgEl('line', { x1: 45, y1: 90, x2: 110, y2: 90, stroke: LINE_STROKE, 'stroke-width': w }));
    g.appendChild(svgEl('rect', {
      x: 110, y: 70, width: 90, height: 40, fill: LINE_FILL, stroke: LINE_STROKE, 'stroke-width': sw,
    }));
    g.appendChild(svgEl('line', { x1: 150, y1: 75, x2: 150, y2: 105, stroke: LINE_STROKE, 'stroke-width': w }));
    g.appendChild(svgEl('line', {
      x1: 155, y1: 70, x2: 155, y2: 35, stroke: ACCENT, 'stroke-width': w,
    }));
    g.appendChild(svgEl('circle', {
      cx: 155, cy: 35, r: 18, fill: 'none', stroke: ACCENT, 'stroke-width': w,
    }));
    g.appendChild(svgEl('line', { x1: 147, y1: 35, x2: 163, y2: 35, stroke: ACCENT, 'stroke-width': 3 }));
    g.appendChild(svgEl('line', { x1: 155, y1: 27, x2: 155, y2: 43, stroke: ACCENT, 'stroke-width': 3 }));
    g.appendChild(svgEl('line', { x1: 149, y1: 29, x2: 161, y2: 41, stroke: ACCENT, 'stroke-width': 3 }));
    g.appendChild(svgEl('line', { x1: 149, y1: 41, x2: 161, y2: 29, stroke: ACCENT, 'stroke-width': 3 }));
    return g;
  },
  diverter: () => {
    const g = createGroup('diverter');
    g.appendChild(svgEl('circle', shapeAttrs({ cx: 70, cy: 70, r: 30 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 0, y1: 70, x2: 140, y2: 70 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 20, y1: 55, x2: 20, y2: 85 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 120, y1: 55, x2: 120, y2: 85 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 91, y1: 91, x2: 135, y2: 135 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 115, y1: 129, x2: 129, y2: 115 })));
    return g;
  },
  hopper: () => {
    const g = createGroup('hopper');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 20, y: 30, width: 140, height: 100 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '20,130 160,130 90,190' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 90, y1: 0, x2: 90, y2: 30 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 0, y1: 70, x2: 20, y2: 70 })));
    [30, 50, 70, 90, 110].forEach((x) => {
      g.appendChild(svgEl('rect', {
        x, y: 55, width: 14, height: 30, fill: 'none', stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
      }));
      g.appendChild(svgEl('line', lineAttrs({ x1: x, y1: 85, x2: x + 14, y2: 55 })));
    });
    return g;
  },
  gravityhopper: () => {
    const g = createGroup('gravityhopper');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 20, width: 100, height: 90 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '0,110 100,110 50,170' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 50, y1: 0, x2: 50, y2: 20 })));
    return g;
  },
  trouserhopper: () => {
    const g = createGroup('trouserhopper');
    g.appendChild(svgEl('polygon', shapeAttrs({
      points: '0,20 140,20 140,110 105,170 70,140 35,170 0,110',
    })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 70, y1: 0, x2: 70, y2: 20 })));
    return g;
  },
  airlock: () => {
    const g = createGroup('airlock');
    g.appendChild(svgEl('circle', shapeAttrs({ cx: 25, cy: 25, r: 22 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 3, y1: 25, x2: 47, y2: 25 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 25, y1: 3, x2: 25, y2: 47 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 9.4, y1: 9.4, x2: 40.6, y2: 40.6 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 9.4, y1: 40.6, x2: 40.6, y2: 9.4 })));
    g.appendChild(svgEl('circle', { cx: 25, cy: 25, r: 3, fill: LINE_STROKE }));
    g.appendChild(svgEl('line', lineAttrs({ x1: 47, y1: 25, x2: 70, y2: 25 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 70, y: 13, width: 48, height: 24 })));
    [17, 21, 25, 29, 33].forEach((y) => {
      g.appendChild(svgEl('line', lineAttrs({ x1: 70, y1: y, x2: 118, y2: y })));
    });
    return g;
  },
  filter: () => {
    const g = createGroup('filter');
    g.appendChild(svgEl('polygon', shapeAttrs({
      points: '0,15 18,15 18,30 26,30 26,45 34,45 34,30 42,30 42,15 60,15 60,105 0,105',
    })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 30, y1: 15, x2: 30, y2: 0 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 30, y1: 105, x2: 30, y2: 215 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 30, y1: 215, x2: 55, y2: 215 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 55, y1: 215, x2: 68, y2: 205 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 55, y1: 215, x2: 68, y2: 225 })));
    g.appendChild(svgEl('circle', shapeAttrs({ cx: 70, cy: 215, r: 10 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 80, y1: 215, x2: 100, y2: 215 })));
    return g;
  },
  cyclone: () => {
    const g = createGroup('cyclone');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 0, width: 15, height: 12 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 15, y: 0, width: 35, height: 40 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '15,40 50,40 32.5,80' })));
    return g;
  },
  sieve: () => {
    const g = createGroup('sieve');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 20, y: 50, width: 140, height: 45 })));
    g.appendChild(svgEl('rect', {
      x: 30, y: 60, width: 95, height: 25, fill: 'none', stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
    }));
    g.appendChild(svgEl('line', lineAttrs({ x1: 140, y1: 50, x2: 140, y2: 95 })));
    g.appendChild(svgEl('polyline', {
      points: '140,52 160,60 140,68 160,76 140,84 160,92',
      fill: 'none', stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
    }));
    g.appendChild(svgEl('polyline', {
      points: '55,25 51,32 59,38 51,44 55,50',
      fill: 'none', stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
    }));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '48,35 62,35 55,50' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 150, y1: 15, x2: 150, y2: 50 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 25, y1: 105, x2: 155, y2: 105 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 25, y1: 105, x2: 25, y2: 210 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 10, y1: 210, x2: 40, y2: 210 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 155, y1: 105, x2: 155, y2: 210 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 140, y1: 210, x2: 170, y2: 210 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 35, y: 95, width: 18, height: 14 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 44, y1: 109, x2: 44, y2: 122 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '40,122 48,122 44,130' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 55, y1: 95, x2: 95, y2: 180 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 135, y1: 95, x2: 95, y2: 180 })));
    return g;
  },
  screwfeeder: () => {
    const g = createGroup('screwfeeder');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 0, y: 15, width: 25, height: 20 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 25, y: 15, width: 110, height: 20 })));
    [35, 50, 65, 80, 95, 110, 125].forEach((x) => {
      g.appendChild(svgEl('line', lineAttrs({ x1: x, y1: 33, x2: x + 12, y2: 17 })));
    });
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '34.5,0 70.5,0 52.5,15' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 135, y1: 35, x2: 135, y2: 55 })));
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
    g.appendChild(svgEl('line', lineAttrs({ x1: 20, y1: 75, x2: 20, y2: 105 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 20, y1: 90, x2: 170, y2: 90 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 115, y1: 20, x2: 165, y2: 20 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 140, y1: 20, x2: 140, y2: 55 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 140, y1: 55, x2: 108, y2: 90 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 150, y1: 75, x2: 150, y2: 105 })));
    g.appendChild(svgEl('circle', { cx: 108, cy: 90, r: 8, fill: LINE_STROKE }));
    return g;
  },
  silo: () => {
    const g = createGroup('silo');
    g.appendChild(svgEl('rect', shapeAttrs({ x: 20, y: 60, width: 100, height: 200 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 20, y1: 260, x2: 55, y2: 300 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 120, y1: 260, x2: 85, y2: 300 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 50, y: 297, width: 40, height: 6 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 50, y1: 291, x2: 50, y2: 304 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 90, y1: 291, x2: 90, y2: 304 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 55, y1: 303, x2: 62, y2: 325 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 85, y1: 303, x2: 78, y2: 325 })));
    g.appendChild(svgEl('rect', shapeAttrs({ x: 62, y: 325, width: 16, height: 10 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 70, y1: 335, x2: 70, y2: 345 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 15, y1: 260, x2: 15, y2: 360 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '5,360 25,360 15,350' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 125, y1: 260, x2: 125, y2: 360 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '115,360 135,360 125,350' })));
    g.appendChild(svgEl('ellipse', shapeAttrs({ cx: 45, cy: 60, rx: 12, ry: 4 })));
    g.appendChild(svgEl('path', {
      d: 'M 63 60 A 6 6 0 0 1 75 60', fill: 'none', stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
    }));
    g.appendChild(svgEl('line', lineAttrs({ x1: 105, y1: 60, x2: 105, y2: 35 })));
    return g;
  },
};

// Posició (en coordenades locals de l'element) dels punts de connexió de
// cada tipus. Els noms de rol (input, input2, output, output2...) es fan
// servir tal qual com a classe/atribut per pintar el punt del color que
// toqui (vegeu styles.css) i per identificar-lo en connectar canonades.
// Els valors de connectionOffsets/rotationPivots/mirrorPivotX ja estan
// expressats en coordenades "post-reducció", és a dir, multiplicats per
// SHAPE_SCALE[type] quan l'element en té una (vegeu més avall). Així els
// punts de connexió (radi fix, vegeu addConnectionPoints) queden exactament
// sobre el contorn de la forma ja reduïda.
const connectionOffsets = {
  pump: { input: { x: 3.75, y: 33.75 }, output: { x: 73.5, y: 33.75 } },
  valve: { input: { x: 11.25, y: 0 }, output: { x: 11.25, y: 45 } },
  diverter: { input: { x: 0, y: 35 }, output: { x: 70, y: 35 }, output2: { x: 67.5, y: 67.5 } },
  hopper: { input: { x: 45, y: 0 }, input2: { x: 0, y: 35 }, output: { x: 45, y: 95 } },
  gravityhopper: { input: { x: 28.125, y: 0 }, output: { x: 28.125, y: 95.625 } },
  trouserhopper: { input: { x: 35, y: 0 }, output: { x: 17.5, y: 85 }, output2: { x: 52.5, y: 85 } },
  airlock: { input: { x: 18.75, y: 2.25 }, output: { x: 18.75, y: 35.25 } },
  filter: { input: { x: 15, y: 0 }, output: { x: 50, y: 107.5 } },
  cyclone: { input: { x: 0, y: 6 }, output: { x: 32.5, y: 80 } },
  sieve: { input: { x: 75, y: 7.5 }, output: { x: 47.5, y: 90 } },
  screwfeeder: { input: { x: 39.375, y: 0 }, output: { x: 101.25, y: 41.25 } },
  bagdump: { input: { x: 0, y: 5 }, output: { x: 30, y: 65 } },
  injector: { input: { x: 10, y: 45 }, input2: { x: 70, y: 10 }, output: { x: 85, y: 45 } },
  silo: { input: { x: 105, y: 35 }, output: { x: 70, y: 345 } },
};

// Punts (locals) al voltant dels quals gira/es mira cada element quan es
// fa servir el menú contextual. Només cal una entrada per als tipus que
// realment tenen aquesta acció disponible (vegeu ROTATABLE_TYPES i
// MIRRORABLE_TYPES més avall). Igual que a connectionOffsets, ja són
// coordenades "post-reducció".
const rotationPivots = {
  valve: { x: 11.25, y: 22.5 },
  diverter: { x: 35, y: 35 },
};

const mirrorPivotX = {
  pump: 33.75,
  airlock: 18.75,
  filter: 15,
  screwfeeder: 50.625,
  injector: 47.5,
  hopper: 45,
};

const ROTATABLE_TYPES = new Set(Object.keys(rotationPivots));
const MIRRORABLE_TYPES = new Set(Object.keys(mirrorPivotX));

// Tipus que, en afegir-se al canvas, ja surten amb la inversió horitzontal
// (mirall) activada d'entrada, en lloc del dibuix original.
const DEFAULT_FLIPPED_TYPES = new Set(['injector']);

const MIN_SCALE = 0.3;
const MAX_SCALE = 5;

// Factor de reducció aplicat al dibuix original de cada tipus (independent
// de l'escala interactiva que dona la funció de redimensionar amb el
// ratolí). Els tipus que no hi apareixen es dibuixen a la mida original.
const SHAPE_SCALE = {
  valve: 0.25,
  hopper: 0.5,
  trouserhopper: 0.5,
  gravityhopper: 0.5625,
  injector: 0.5,
  filter: 0.5,
  airlock: 0.75,
  pump: 0.75,
  sieve: 0.5,
  screwfeeder: 0.75,
  diverter: 0.5,
};

function createGroup(type) {
  const g = document.createElementNS(svgNS, 'g');
  g.classList.add('pid-element');
  g.dataset.type = type;
  return g;
}

// Embolcalla tot el dibuix (els fills que la plantilla ja ha afegit a `g`)
// dins un <g> intern amb un scale() fix. Es fa servir NOMÉS per reduir la
// mida del dibuix original; els punts de connexió s'afegeixen després,
// directament a `g`, de manera que queden fora d'aquest escalat i sempre
// es dibuixen amb el mateix radi (vegeu addConnectionPoints).
function applyShapeScale(g, type) {
  const factor = SHAPE_SCALE[type];
  if (!factor || factor === 1) return;

  const inner = document.createElementNS(svgNS, 'g');
  inner.setAttribute('transform', `scale(${factor})`);
  while (g.firstChild) inner.appendChild(g.firstChild);
  g.appendChild(inner);
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
  applyShapeScale(g, type);
  elementCount += 1;
  g.dataset.id = `${type}-${elementCount}`;
  g.dataset.rotation = '0';
  g.dataset.flipped = DEFAULT_FLIPPED_TYPES.has(type) ? '1' : '0';
  g.dataset.scale = '1';

  const x = 40 + (elementCount * 15) % 300;
  const y = 40 + (elementCount * 25) % 200;
  setElementPosition(g, x, y);

  addConnectionPoints(g, type);
  makeDraggable(g);
  makeConnectable(g);
  viewport.appendChild(g);
}

// Construeix i aplica l'atribut transform d'un element a partir de la seva
// posició (x, y) i del seu estat de rotació/mirall/escala actual. El
// translate va sempre primer perquè getTranslate() només llegeix el primer
// component. L'escala és el component més intern (el primer que s'aplica al
// punt local), per això els pivots de rotació/mirall es multipliquen per
// l'escala: així roten/es reflecteixen al voltant del mateix punt visual de
// la forma tant si està a mida normal com ampliada o reduïda.
function setElementPosition(element, x, y) {
  const type = element.dataset.type;
  const parts = [`translate(${x}, ${y})`];
  const scale = Number(element.dataset.scale || 1);

  const rotation = Number(element.dataset.rotation || 0);
  if (rotation) {
    const pivot = rotationPivots[type];
    parts.push(`rotate(${rotation}, ${pivot.x * scale}, ${pivot.y * scale})`);
  }

  if (element.dataset.flipped === '1') {
    const cx = mirrorPivotX[type];
    parts.push(`translate(${2 * cx * scale}, 0) scale(-1, 1)`);
  }

  if (scale !== 1) {
    parts.push(`scale(${scale}, ${scale})`);
  }

  element.setAttribute('transform', parts.join(' '));
}

// Torna a aplicar el transform d'un element mantenint la posició actual
// (es fa servir després de canviar la rotació o el mirall).
function reapplyElementTransform(element) {
  const { x, y } = getTranslate(element);
  setElementPosition(element, x, y);
}

// Gira l'element 90° (només disponible per als tipus a ROTATABLE_TYPES)
function rotateElement(element) {
  const current = Number(element.dataset.rotation || 0);
  element.dataset.rotation = String((current + 90) % 360);
  reapplyElementTransform(element);
  updateConnectedPipes(element);
  refreshSelectionFrame(element);
}

// Fa una inversió horitzontal (mirall) de l'element (només disponible per
// als tipus a MIRRORABLE_TYPES)
function mirrorElement(element) {
  element.dataset.flipped = element.dataset.flipped === '1' ? '0' : '1';
  reapplyElementTransform(element);
  updateConnectedPipes(element);
  refreshSelectionFrame(element);
}

// Permet arrossegar un element (dipòsit, bomba o vàlvula) dins el canvas.
// Si l'element ja formava part d'una selecció múltiple (marc de selecció),
// arrossegar-lo mou junts tots els elements seleccionats.
function makeDraggable(element) {
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let groupStarts = null;

  element.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    dragging = true;

    const isGroupDrag = selectedElements.has(element) && selectedElements.size > 1;
    if (!isGroupDrag) {
      selectElement(element);
    }

    const { x, y } = getTranslate(element);
    const world = clientToWorld(event.clientX, event.clientY);
    offsetX = world.x - x;
    offsetY = world.y - y;

    groupStarts = isGroupDrag
      ? new Map([...selectedElements].map((el) => [el, getTranslate(el)]))
      : null;
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    const world = clientToWorld(event.clientX, event.clientY);
    const x = world.x - offsetX;
    const y = world.y - offsetY;

    if (groupStarts) {
      const start = groupStarts.get(element);
      const dx = x - start.x;
      const dy = y - start.y;
      groupStarts.forEach((elStart, el) => {
        setElementPosition(el, elStart.x + dx, elStart.y + dy);
        updateConnectedPipes(el);
      });
      updateSelectionFrame();
    } else {
      setElementPosition(element, x, y);
      updateConnectedPipes(element);
      refreshSelectionFrame(element);
    }
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    groupStarts = null;
  });
}

// ---- Selecció (individual o múltiple) i redimensionament ----
// En seleccionar un element (qualsevol tipus, excepte les canonades) es
// mostra un marc HTML (com el menú contextual, posicionat amb
// getBoundingClientRect(), no un element SVG). Amb una única selecció, el
// marc porta 4 nanses a les cantonades a l'estil d'inserir una imatge en un
// document: arrossegar-ne una n'escala la mida mantenint la cantonada
// oposada fixa a la pantalla. Amb selecció múltiple (requadre d'arrossegar,
// vegeu beginMarqueeSelect) cada element rep un marc simple sense nanses,
// ja que l'objectiu és poder-los moure junts, no redimensionar-los junts.
const selectedElements = new Set();
const selectionFrames = new Map();

const HANDLE_CORNERS = ['nw', 'ne', 'sw', 'se'];
const OPPOSITE_CORNER = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };

function cornerPoint(rect, corner) {
  return {
    x: corner.includes('w') ? rect.left : rect.right,
    y: corner[0] === 'n' ? rect.top : rect.bottom,
  };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clearSelection() {
  selectionFrames.forEach((frame) => frame.remove());
  selectionFrames.clear();
  selectedElements.clear();
}

// Treu un únic element d'una selecció múltiple (per exemple quan s'elimina),
// sense afectar la resta d'elements seleccionats.
function deselectElement(element) {
  const frame = selectionFrames.get(element);
  if (frame) frame.remove();
  selectionFrames.delete(element);
  selectedElements.delete(element);
}

function selectElement(element) {
  if (element.dataset.type === 'pipe') return;
  if (selectedElements.size === 1 && selectedElements.has(element)) return;
  clearSelection();
  selectedElements.add(element);
  buildSelectionFrame(element, true);
}

// Selecciona un conjunt d'elements alhora (requadre de selecció). Si només
// n'hi ha un, es comporta igual que selectElement (amb nanses de redimensió).
function selectMultiple(elements) {
  clearSelection();
  if (!elements.length) return;
  elements.forEach((el) => selectedElements.add(el));
  const withHandles = selectedElements.size === 1;
  selectedElements.forEach((el) => buildSelectionFrame(el, withHandles));
}

function buildSelectionFrame(element, withHandles) {
  const frame = document.createElement('div');
  frame.className = 'selection-frame';
  if (withHandles) {
    HANDLE_CORNERS.forEach((corner) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-handle--${corner}`;
      handle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginResize(element, corner);
      });
      frame.appendChild(handle);
    });
  }
  document.body.appendChild(frame);
  selectionFrames.set(element, frame);
  updateFrameFor(element);
}

function updateFrameFor(element) {
  const frame = selectionFrames.get(element);
  if (!frame) return;
  const rect = element.getBoundingClientRect();
  frame.style.left = `${rect.left}px`;
  frame.style.top = `${rect.top}px`;
  frame.style.width = `${rect.width}px`;
  frame.style.height = `${rect.height}px`;
}

// Torna a dibuixar tots els marcs de selecció actuals (es fa servir després
// de redimensionar o de moure una selecció múltiple sencera).
function updateSelectionFrame() {
  selectedElements.forEach(updateFrameFor);
}

// Torna a dibuixar el marc de selecció d'un element concret, només si
// forma part de la selecció actual.
function refreshSelectionFrame(element) {
  if (selectedElements.has(element)) updateFrameFor(element);
}

// Arrossegar una nansa escala l'element mantenint fixa (a la pantalla) la
// cantonada oposada a la que s'arrossega. Com que llegim la mida real
// renderitzada amb getBoundingClientRect() després de cada canvi d'escala,
// no cal recalcular a mà com interactuen la rotació, el mirall i l'escala.
function beginResize(element, corner) {
  const startRect = element.getBoundingClientRect();
  const anchorClient = cornerPoint(startRect, OPPOSITE_CORNER[corner]);
  const draggedClient = cornerPoint(startRect, corner);
  const startDist = distance(anchorClient, draggedClient);
  const startScale = Number(element.dataset.scale || 1);
  const { x: startX, y: startY } = getTranslate(element);

  function onMouseMove(event) {
    const currentDist = distance(anchorClient, { x: event.clientX, y: event.clientY });
    const ratio = startDist > 1 ? currentDist / startDist : 1;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * ratio));
    element.dataset.scale = String(newScale);

    setElementPosition(element, startX, startY);
    const measuredRect = element.getBoundingClientRect();
    const measuredAnchor = cornerPoint(measuredRect, OPPOSITE_CORNER[corner]);
    // anchorClient/measuredAnchor són en píxels de pantalla; cal desfer el
    // zoom de la vista per obtenir el desplaçament en unitats de món.
    const dx = (anchorClient.x - measuredAnchor.x) / viewScale;
    const dy = (anchorClient.y - measuredAnchor.y) / viewScale;
    setElementPosition(element, startX + dx, startY + dy);

    updateConnectedPipes(element);
    updateSelectionFrame();
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// Clicar fora de qualsevol element (i fora del propi marc de selecció o del
// menú contextual) deselecciona i amaga el(s) marc(s). El requadre de
// selecció (marquee-select) ja fa la seva pròpia crida a clearSelection()
// en començar, així que no cal excloure'l aquí.
window.addEventListener('mousedown', (event) => {
  if (
    event.target.closest('.pid-element')
    || event.target.closest('.selection-frame')
    || event.target.closest('.context-menu')
  ) return;
  clearSelection();
});

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

// Calcula la posició real (en coordenades del canvas) d'un punt de connexió,
// aplicant-hi la matriu de transformació completa de l'element (translate +
// rotate + mirall si en té), no només la seva posició de translate.
function getConnectionPointPosition(element, role) {
  const offset = connectionOffsets[element.dataset.type][role];
  const point = canvas.createSVGPoint();
  point.x = offset.x;
  point.y = offset.y;
  const matrix = element.transform.baseVal.consolidate().matrix;
  const transformed = point.matrixTransform(matrix);
  return { x: transformed.x, y: transformed.y };
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
  viewport.prepend(group);

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

    const mouseX = clientToWorld(event.clientX, event.clientY).x;
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
      viewport.appendChild(previewPath);
      pendingPipe = { fromElement: element, fromRole: point.dataset.role, previewPath };
    });
  });
}

window.addEventListener('mousemove', (event) => {
  if (!pendingPipe) return;
  const a = getConnectionPointPosition(pendingPipe.fromElement, pendingPipe.fromRole);
  const b = clientToWorld(event.clientX, event.clientY);
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
// Construeix la llista d'opcions per a un element concret: "Rotar 90°" i
// "Girar (mirall)" només apareixen per als tipus que ho admeten
// (ROTATABLE_TYPES / MIRRORABLE_TYPES); "Eliminar element" és sempre present.
function getContextMenuItems(element) {
  const type = element.dataset.type;
  const items = [];

  if (ROTATABLE_TYPES.has(type)) {
    items.push({ label: 'Rotar 90°', action: (el) => rotateElement(el) });
  }
  if (MIRRORABLE_TYPES.has(type)) {
    items.push({ label: 'Girar (mirall)', action: (el) => mirrorElement(el) });
  }
  items.push({ label: 'Eliminar element', action: (el) => removeElement(el) });

  return items;
}

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

  if (selectedElements.has(element)) deselectElement(element);
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

// Buida completament l'espai de treball: elimina tots els elements i
// canonades del canvas i reinicia el comptador d'identificadors.
function clearAll() {
  pipes.length = 0;
  viewport.replaceChildren();
  elementCount = 0;
  clearSelection();
}

clearAllButton.addEventListener('click', clearAll);

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

  getContextMenuItems(element).forEach((item) => {
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

// ---- Zoom amb la roda del ratolí ----
// El punt del món que hi ha just sota el cursor es manté fix a la pantalla:
// és per això que cal recalcular viewX/viewY després de canviar viewScale,
// en lloc de només escalar al voltant del centre del canvas.
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const worldX = (mouseX - viewX) / viewScale;
  const worldY = (mouseY - viewY) / viewScale;

  const zoomFactor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  viewScale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, viewScale * zoomFactor));

  viewX = mouseX - worldX * viewScale;
  viewY = mouseY - worldY * viewScale;
  applyViewport();
}, { passive: false });

// ---- Desplaçament (pan) arrossegant amb el botó del mig ----
// Es pot iniciar en qualsevol punt del canvas (fins i tot sobre un element)
// perquè no cal aixecar el dit del botó del mig per passar per sobre d'una
// forma; el botó esquerre queda lliure per moure elements i per al
// requadre de selecció.
let panning = false;
let panStartClientX = 0;
let panStartClientY = 0;
let panStartViewX = 0;
let panStartViewY = 0;

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 1) return;
  event.preventDefault();

  panning = true;
  panStartClientX = event.clientX;
  panStartClientY = event.clientY;
  panStartViewX = viewX;
  panStartViewY = viewY;
  canvas.classList.add('panning');
});

window.addEventListener('mousemove', (event) => {
  if (!panning) return;
  viewX = panStartViewX + (event.clientX - panStartClientX);
  viewY = panStartViewY + (event.clientY - panStartClientY);
  applyViewport();
});

window.addEventListener('mouseup', (event) => {
  if (!panning || event.button !== 1) return;
  panning = false;
  canvas.classList.remove('panning');
});

// Evita que el navegador obri l'scroll automàtic ("autoscroll") en clicar
// el botó del mig, que és l'acció que ara fem servir per desplaçar el canvas.
canvas.addEventListener('auxclick', (event) => {
  if (event.button === 1) event.preventDefault();
});

// ---- Requadre de selecció arrossegant amb el botó esquerre ----
// Iniciat sobre el fons buit del canvas (no sobre un element): dibuixa un
// requadre mentre s'arrossega i, en deixar anar, selecciona tots els
// elements el rectangle dels quals intersecti amb el requadre. Així es pot
// moure diversos elements alhora (vegeu el suport de "group drag" a
// makeDraggable).
let marqueeStartClient = null;
let marqueeEl = null;

function updateMarqueeVisual(clientX, clientY) {
  const x1 = Math.min(marqueeStartClient.x, clientX);
  const y1 = Math.min(marqueeStartClient.y, clientY);
  const x2 = Math.max(marqueeStartClient.x, clientX);
  const y2 = Math.max(marqueeStartClient.y, clientY);
  marqueeEl.style.left = `${x1}px`;
  marqueeEl.style.top = `${y1}px`;
  marqueeEl.style.width = `${x2 - x1}px`;
  marqueeEl.style.height = `${y2 - y1}px`;
  return { x1, y1, x2, y2 };
}

function onMarqueeMove(event) {
  updateMarqueeVisual(event.clientX, event.clientY);
}

function onMarqueeUp(event) {
  window.removeEventListener('mousemove', onMarqueeMove);
  window.removeEventListener('mouseup', onMarqueeUp);

  const rect = updateMarqueeVisual(event.clientX, event.clientY);
  marqueeEl.remove();
  marqueeEl = null;

  const matched = [];
  viewport.querySelectorAll('.pid-element:not(.pipe)').forEach((element) => {
    const r = element.getBoundingClientRect();
    const intersects = r.left < rect.x2 && r.right > rect.x1 && r.top < rect.y2 && r.bottom > rect.y1;
    if (intersects) matched.push(element);
  });

  selectMultiple(matched);
}

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (event.target.closest('.pid-element')) return;

  clearSelection();
  marqueeStartClient = { x: event.clientX, y: event.clientY };
  marqueeEl = document.createElement('div');
  marqueeEl.className = 'marquee-select';
  document.body.appendChild(marqueeEl);
  updateMarqueeVisual(event.clientX, event.clientY);

  window.addEventListener('mousemove', onMarqueeMove);
  window.addEventListener('mouseup', onMarqueeUp);
});
