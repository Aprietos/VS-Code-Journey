const canvas = document.getElementById('canvas');
const canvasContainer = document.getElementById('canvas-container');
const toolbar = document.querySelector('.tool-groups');
const clearAllButton = document.getElementById('clear-all');
const undoButton = document.getElementById('undo-btn');
const redoButton = document.getElementById('redo-btn');

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
    g.appendChild(svgEl('rect', shapeAttrs({ x: 28, y: 30, width: 92, height: 107 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '28,137 120,137 74,199' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 74, y1: 0, x2: 74, y2: 30 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 0, y1: 87, x2: 28, y2: 87 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 74, y1: 199, x2: 74, y2: 206 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 28, y1: 58, x2: 120, y2: 58 })));
    [37, 57, 77, 97].forEach((x) => {
      g.appendChild(svgEl('rect', {
        x, y: 58, width: 14, height: 36, fill: 'none', stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
      }));
      g.appendChild(svgEl('line', lineAttrs({ x1: x + 2, y1: 60, x2: x + 12, y2: 92 })));
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
    g.appendChild(svgEl('rect', shapeAttrs({ x: 17, y: 11, width: 46, height: 71 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 63, y1: 11, x2: 17, y2: 82 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 40, y1: 82, x2: 40, y2: 180 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 40, y1: 180, x2: 78, y2: 180 })));
    g.appendChild(svgEl('path', {
      d: 'M 78 180 Q 108 163 138 180 Q 108 197 78 180 Z',
      fill: LINE_FILL, stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
    }));
    g.appendChild(svgEl('circle', {
      cx: 108, cy: 180, r: 9, fill: 'none', stroke: LINE_STROKE, 'stroke-width': DETAIL_WIDTH,
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
    g.appendChild(svgEl('line', lineAttrs({ x1: 15, y1: 10, x2: 60, y2: 45 })));
    g.appendChild(svgEl('polygon', shapeAttrs({ points: '60,45 105,45 105,120 60,180 15,120 15,110' })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 15, y1: 110, x2: 105, y2: 110 })));
    g.appendChild(svgEl('line', lineAttrs({ x1: 60, y1: 180, x2: 60, y2: 192 })));
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
// cada tipus. Els noms de rol es fan servir tal qual com a classe/atribut
// per pintar el punt del color que toqui (vegeu styles.css) i per
// identificar-lo en connectar canonades. Hi ha tres famílies: input/input2...
// per a les entrades, output/output2... per a les sortides i
// common/branch/branch2 per als elements sense un sentit de flux fix, on un
// mateix punt pot fer d'entrada o de sortida segons com es faci servir
// l'element (ara mateix, només la desviadora).
// Els valors de connectionOffsets/rotationPivots/mirrorPivotX ja estan
// expressats en coordenades "post-reducció", és a dir, multiplicats per
// SHAPE_SCALE[type] quan l'element en té una (vegeu més avall). Així els
// punts de connexió (radi fix, vegeu addConnectionPoints) queden exactament
// sobre el contorn de la forma ja reduïda.
const connectionOffsets = {
  pump: { output: { x: 73.5, y: 33.75 } },
  valve: { input: { x: 11.25, y: 0 }, output: { x: 11.25, y: 45 } },
  // La desviadora pot dividir (1 → 2) o ajuntar (2 → 1), de manera que cap
  // dels seus punts és entrada o sortida per definició. Es diuen, doncs, pel
  // paper que fan a la forma: `common` és el punt sol d'un costat i
  // `branch`/`branch2` les dues vies de l'altre (la recta i la desviada).
  // Vegeu PORT_SIDES, que és qui imposa que el producte hagi de creuar de
  // `common` a una branca i no pugui mai anar d'una branca a l'altra.
  diverter: { common: { x: 0, y: 35 }, branch: { x: 70, y: 35 }, branch2: { x: 67.5, y: 67.5 } },
  hopper: { input2: { x: 0, y: 43.5 }, output: { x: 37, y: 103 }, output2: { x: 37, y: 0 } },
  gravityhopper: { input: { x: 28.125, y: 0 }, output: { x: 28.125, y: 95.625 } },
  trouserhopper: { input: { x: 35, y: 0 }, output: { x: 17.5, y: 85 }, output2: { x: 52.5, y: 85 } },
  airlock: { input: { x: 18.75, y: 2.25 }, output: { x: 18.75, y: 35.25 } },
  filter: { output: { x: 69, y: 90 } },
  cyclone: { input: { x: 0, y: 6 }, output: { x: 32.5, y: 80 } },
  sieve: { input: { x: 75, y: 7.5 }, output: { x: 47.5, y: 90 } },
  screwfeeder: { input: { x: 39.375, y: 0 }, output: { x: 101.25, y: 41.25 } },
  bagdump: { output: { x: 30, y: 98 } },
  // input/output tenen les x intercanviades respecte al dibuix original
  // (injector a templates) perquè l'injector surt per defecte amb mirall
  // aplicat (vegeu DEFAULT_FLIPPED_TYPES): així, en la seva orientació
  // habitual, el punt de l'esquerra (i el de dalt, input2) són vermells i
  // el de la dreta és verd, tal com correspon al seu funcionament.
  injector: { input: { x: 85, y: 45 }, input2: { x: 70, y: 10 }, output: { x: 10, y: 45 } },
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
  filter: 38.75,
  screwfeeder: 50.625,
  injector: 47.5,
  hopper: 37,
  bagdump: 30,
};

const ROTATABLE_TYPES = new Set(Object.keys(rotationPivots));
const MIRRORABLE_TYPES = new Set(Object.keys(mirrorPivotX));

// Direcció "natural" (horitzontal o vertical) de cada punt de connexió,
// mesurada sobre el dibuix local sense rotar/reflectir: 'h' si el punt és
// a un costat de la forma (la canonada hi arriba de costat) i 'v' si és a
// dalt o a baix (hi arriba en vertical). S'fa servir com a direcció inicial
// d'una canonada nova (vegeu getNaturalPortDirection); un cop connectada,
// cada extrem es pot canviar de direcció clicant-hi (vegeu
// togglePipeEndpointDirection).
const PORT_DIRECTIONS = {
  pump: { output: 'h' },
  valve: { input: 'v', output: 'v' },
  diverter: { common: 'h', branch: 'h', branch2: 'v' },
  hopper: { input2: 'h', output: 'v', output2: 'v' },
  gravityhopper: { input: 'v', output: 'v' },
  trouserhopper: { input: 'v', output: 'v', output2: 'v' },
  airlock: { input: 'v', output: 'v' },
  filter: { output: 'h' },
  cyclone: { input: 'h', output: 'v' },
  sieve: { input: 'v', output: 'v' },
  screwfeeder: { input: 'v', output: 'v' },
  bagdump: { output: 'v' },
  injector: { input: 'h', input2: 'v', output: 'h' },
  silo: { input: 'v', output: 'v' },
};

// Direcció efectiva d'un punt de connexió ara mateix, tenint en compte la
// rotació actual de l'element: girar-lo 90°/270° intercanvia horitzontal i
// vertical; el mirall no ho canvia.
function getNaturalPortDirection(element, role) {
  const type = element.dataset.type;
  const base = (PORT_DIRECTIONS[type] && PORT_DIRECTIONS[type][role]) || 'h';
  const rotation = Number(element.dataset.rotation || 0);
  const swapped = rotation % 180 !== 0;
  return swapped ? (base === 'h' ? 'v' : 'h') : base;
}

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
  bagdump: 0.5,
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

// Construeix una instància nova d'un tipus d'element (amb els seus punts de
// connexió i el comportament d'arrossegar/connectar ja enganxats), sense
// posicionar-la ni afegir-la al canvas. Es fa servir tant per afegir un
// element des de la barra d'eines (addElement) com per enganxar-ne una
// còpia (pasteClipboard).
// Construeix la part "bàsica" d'un element (dibuix, punts de connexió i
// comportament d'arrossegar/connectar) sense assignar-li identificador ni
// estat de rotació/mirall/escala. Es fa servir tant per crear-ne una
// instància nova (createElementInstance) com per reconstruir-ne una des
// d'una captura de l'historial (vegeu restoreState).
function buildBareElement(type) {
  const build = templates[type];
  if (!build) return null;

  const g = build();
  applyShapeScale(g, type);
  addConnectionPoints(g, type);
  makeDraggable(g);
  makeConnectable(g);
  makeRoleEditable(g);
  return g;
}

function createElementInstance(type) {
  const g = buildBareElement(type);
  if (!g) return null;

  elementCount += 1;
  g.dataset.id = `${type}-${elementCount}`;
  g.dataset.rotation = '0';
  g.dataset.flipped = DEFAULT_FLIPPED_TYPES.has(type) ? '1' : '0';
  g.dataset.scale = '1';
  return g;
}

// Afegeix un element nou al centre aproximat del canvas
function addElement(type) {
  const g = createElementInstance(type);
  if (!g) return;

  const x = 40 + (elementCount * 15) % 300;
  const y = 40 + (elementCount * 25) % 200;
  setElementPosition(g, x, y);
  viewport.appendChild(g);
  pushHistory();
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
  // Transformacions que desfan les de `parts` (en ordre invers), per al
  // distintiu de rol: així el text es queda sempre dret i a mida constant
  // encara que l'element estigui girat, reflectit o escalat.
  const undo = [];
  const scale = Number(element.dataset.scale || 1);

  const rotation = Number(element.dataset.rotation || 0);
  if (rotation) {
    const pivot = rotationPivots[type];
    parts.push(`rotate(${rotation}, ${pivot.x * scale}, ${pivot.y * scale})`);
    undo.unshift(`rotate(${-rotation}, ${pivot.x * scale}, ${pivot.y * scale})`);
  }

  if (element.dataset.flipped === '1') {
    const cx = mirrorPivotX[type];
    parts.push(`translate(${2 * cx * scale}, 0) scale(-1, 1)`);
    // Una reflexió és la seva pròpia inversa.
    undo.unshift(`translate(${2 * cx * scale}, 0) scale(-1, 1)`);
  }

  if (scale !== 1) {
    parts.push(`scale(${scale}, ${scale})`);
    undo.unshift(`scale(${1 / scale}, ${1 / scale})`);
  }

  element.setAttribute('transform', parts.join(' '));

  const badge = element.querySelector('.role-badge');
  if (badge) badge.setAttribute('transform', undo.join(' '));
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
  pushHistory();
}

// Fa una inversió horitzontal (mirall) de l'element (només disponible per
// als tipus a MIRRORABLE_TYPES)
function mirrorElement(element) {
  element.dataset.flipped = element.dataset.flipped === '1' ? '0' : '1';
  reapplyElementTransform(element);
  updateConnectedPipes(element);
  refreshSelectionFrame(element);
  pushHistory();
}

// Permet arrossegar un element (dipòsit, bomba o vàlvula) dins el canvas.
// Si l'element ja formava part d'una selecció múltiple (marc de selecció),
// arrossegar-lo mou junts tots els elements seleccionats.
//
// Els listeners de moviment/final es creen i es destrueixen a cada
// arrossegament (en lloc de quedar-se permanentment enganxats a `window`
// darrere d'un booleà), i es fa servir setPointerCapture perquè aquests
// esdeveniments arribin sempre a `element` encara que el cursor surti
// momentàniament de la finestra. Així, si algun cop el ratolí es deixa anar
// fora del navegador (l'"mouseup" es podia perdre amb l'enfocament antic),
// no queda cap arrossegament "encallat" que faci saltar l'element la
// pròxima vegada que es mogui el ratolí per qualsevol altre motiu.
function makeDraggable(element) {
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    const isGroupDrag = selectedElements.has(element) && selectedElements.size > 1;
    if (!isGroupDrag) {
      selectElement(element);
    }

    const { x, y } = getTranslate(element);
    const world = clientToWorld(event.clientX, event.clientY);
    const offsetX = world.x - x;
    const offsetY = world.y - y;

    const groupStarts = isGroupDrag
      ? new Map([...selectedElements].map((el) => [el, getTranslate(el)]))
      : null;

    element.setPointerCapture(event.pointerId);
    let moved = false;

    function onPointerMove(moveEvent) {
      moved = true;
      const w = clientToWorld(moveEvent.clientX, moveEvent.clientY);
      const nx = w.x - offsetX;
      const ny = w.y - offsetY;

      if (groupStarts) {
        const start = groupStarts.get(element);
        const dx = nx - start.x;
        const dy = ny - start.y;
        groupStarts.forEach((elStart, el) => {
          setElementPosition(el, elStart.x + dx, elStart.y + dy);
          updateConnectedPipes(el);
        });
        updateSelectionFrame();
      } else {
        setElementPosition(element, nx, ny);
        updateConnectedPipes(element);
        refreshSelectionFrame(element);
      }
    }

    function endDrag() {
      element.releasePointerCapture(event.pointerId);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      if (moved) pushHistory();
    }

    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
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
  let moved = false;

  function onMouseMove(event) {
    moved = true;
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
    if (moved) pushHistory();
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// Clicar fora de qualsevol element (i fora del propi marc de selecció o del
// menú contextual) deselecciona i amaga el(s) marc(s). El requadre de
// selecció (marquee-select) ja fa la seva pròpia crida a clearSelection()
// en començar, així que no cal excloure'l aquí. Només compta el botó
// esquerre: amb el dret volem obrir el menú contextual (o, sobre fons buit,
// no fer res més que això), no esborrar la selecció que hi hagi.
window.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (
    event.target.closest('.pid-element')
    || event.target.closest('.selection-frame')
    || event.target.closest('.context-menu')
  ) return;
  clearSelection();
});

// ---- Sistema de canonades (connectors entre elements) ----
// Cada canonada es representa amb un camí ortogonal de N trams que alternen
// direcció horitzontal/vertical, començant amb la direcció del punt
// d'origen (from.dir) i acabant amb la del punt de destí (to.dir). En
// crear-se, cada extrem pren la direcció "natural" del seu punt de connexió
// (vegeu getNaturalPortDirection): si el punt és a dalt/baix de l'element hi
// arriba en vertical; si és al costat, en horitzontal. El nombre mínim de
// trams és 2 (direccions diferents, sense cap tram arrossegable, només un
// colze) o 3 (mateixa direcció, amb un tram intermedi arrossegable, com
// abans). Clicar un punt ja connectat (vegeu makeConnectable) inverteix la
// direcció d'aquell extrem i afegeix un tram més a la canonada, de manera
// que cada clic la fa una mica més llarga i flexible; a partir de 2 trams
// intermedis tots són arrossegables (vegeu buildPipePoints/syncPipeHandles).
const pipes = [];
let pendingPipe = null;

function getTranslate(element) {
  const transform = element.transform.baseVal.getItem(0);
  return { x: transform.matrix.e, y: transform.matrix.f };
}

// Combina tots els components de l'atribut transform d'un element
// (translate + rotate + mirall + scale) en una única matriu, SENSE fer
// servir SVGTransformList.consolidate(): aquell mètode no és de només
// lectura, sinó que substitueix permanentment la llista de transformacions
// per un únic ítem amb la matriu resultant. Si es fes servir aquí, el
// primer ítem deixaria de ser el translate(x, y) pur que getTranslate()
// espera trobar a getItem(0), i qualsevol arrossegament posterior calcularia
// malament el punt d'ancoratge (el bug apareixia només en elements
// connectats per canonada i, a més, girats/reflectits).
function getLocalMatrix(element) {
  const list = element.transform.baseVal;
  let matrix = canvas.createSVGMatrix();
  for (let i = 0; i < list.numberOfItems; i += 1) {
    matrix = matrix.multiply(list.getItem(i).matrix);
  }
  return matrix;
}

// Calcula la posició real (en coordenades del canvas) d'un punt de connexió,
// aplicant-hi la matriu de transformació completa de l'element (translate +
// rotate + mirall si en té), no només la seva posició de translate.
function getConnectionPointPosition(element, role) {
  const offset = connectionOffsets[element.dataset.type][role];
  const point = canvas.createSVGPoint();
  point.x = offset.x;
  point.y = offset.y;
  const transformed = point.matrixTransform(getLocalMatrix(element));
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

function axisFor(dir) {
  return dir === 'h' ? 'y' : 'x';
}

function pointsToPathD(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

// Traçat simple (3 trams horitzontal-vertical-horitzontal) fet servir només
// per a la línia de previsualització mentre s'arrossega una canonada nova,
// abans de saber a quin punt es connectarà ni quina direcció tindrà.
function previewPipePath(a, b) {
  const midX = a.x + (b.x - a.x) / 2;
  return pointsToPathD([a, { x: midX, y: a.y }, { x: midX, y: b.y }, b]);
}

function minSegmentsFor(dirFrom, dirTo) {
  return dirFrom === dirTo ? 3 : 2;
}

// Calcula els punts (incloent A i B) d'una canonada de `segments` trams que
// alternen direcció a partir de `dirFrom`. Cada punt intermedi comparteix
// amb l'anterior l'eix del seu tram; l'altre eix ve donat per `freeValues`
// (una proporció 0..1 entre A i B, arrossegable per l'usuari), excepte el
// darrer punt intermedi, que sempre queda fixat perquè l'últim tram arribi
// net a B (per això només hi ha segments-2 valors lliures).
function buildPipePoints(a, b, dirFrom, segments, freeValues) {
  const dirs = [];
  let d = dirFrom;
  for (let i = 0; i < segments; i += 1) {
    dirs.push(d);
    d = d === 'h' ? 'v' : 'h';
  }

  const points = [a];
  let prev = a;
  for (let k = 1; k <= segments - 1; k += 1) {
    const sharedAxis = axisFor(dirs[k - 1]);
    const otherAxis = sharedAxis === 'x' ? 'y' : 'x';
    const point = { [sharedAxis]: prev[sharedAxis] };
    point[otherAxis] = k <= segments - 2
      ? a[otherAxis] + freeValues[k - 1] * (b[otherAxis] - a[otherAxis])
      : b[otherAxis];
    points.push(point);
    prev = point;
  }
  points.push(b);
  return points;
}

// Recalcula el traçat d'una canonada a partir de la posició actual dels
// elements que connecta, de la direcció del seu extrem d'origen i dels
// valors dels trams intermedis arrossegables.
function updatePipe(pipe) {
  const a = getConnectionPointPosition(pipe.from.element, pipe.from.point);
  const b = getConnectionPointPosition(pipe.to.element, pipe.to.point);
  const points = buildPipePoints(a, b, pipe.from.dir, pipe.segments, pipe.freeValues);

  pipe.path.setAttribute('d', pointsToPathD(points));
  pipe.handles.forEach((handle, i) => {
    const point = points[i + 1];
    handle.circle.setAttribute('cx', point.x);
    handle.circle.setAttribute('cy', point.y);
  });
}

// Actualitza totes les canonades connectades a un element que s'acaba de moure
function updateConnectedPipes(element) {
  pipes
    .filter((pipe) => pipe.from.element === element || pipe.to.element === element)
    .forEach(updatePipe);
}

// Crea (si cal) les nanses arrossegables que li falten a una canonada
// perquè n'hi hagi exactament una per cada valor lliure (segments - 2), i
// actualitza l'eix (x o y) en què es pot arrossegar cadascuna segons la
// seva posició a la cadena de trams.
function syncPipeHandles(pipe) {
  const dirs = [];
  let d = pipe.from.dir;
  for (let i = 0; i < pipe.segments; i += 1) {
    dirs.push(d);
    d = d === 'h' ? 'v' : 'h';
  }

  while (pipe.handles.length < pipe.freeValues.length) {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.classList.add('pipe-handle');
    circle.setAttribute('r', 4);
    pipe.group.appendChild(circle);
    const handle = { circle, index: pipe.handles.length, axis: 'x' };
    pipe.handles.push(handle);
    makeHandleDraggable(pipe, handle);
  }

  pipe.handles.forEach((handle, i) => {
    const sharedAxis = axisFor(dirs[i]);
    handle.axis = sharedAxis === 'x' ? 'y' : 'x';
    handle.circle.classList.toggle('pipe-handle--vertical', handle.axis === 'y');
  });
}

// Crea la canonada real (DOM + registre a `pipes`) amb un nombre de trams i
// uns valors lliures concrets. Es fa servir tant en connectar dos punts de
// connexió (createPipe, amb els valors mínims per defecte) com en
// reconstruir una canonada des d'una captura de l'historial (restoreState),
// on cal respectar exactament els trams que l'usuari hagi afegit.
function buildPipe(fromElement, fromRole, fromDir, toElement, toRole, toDir, segments, freeValues) {
  const group = document.createElementNS(svgNS, 'g');
  group.classList.add('pid-element', 'pipe');
  group.dataset.type = 'pipe';

  const path = document.createElementNS(svgNS, 'path');
  path.classList.add('pipe-path');
  group.appendChild(path);
  viewport.prepend(group);

  const pipe = {
    from: { element: fromElement, point: fromRole, dir: fromDir },
    to: { element: toElement, point: toRole, dir: toDir },
    segments,
    freeValues: [...freeValues],
    group,
    path,
    handles: [],
  };

  pipes.push(pipe);
  syncPipeHandles(pipe);
  updatePipe(pipe);
  updatePointConnectedState(fromElement);
  updatePointConnectedState(toElement);
  return pipe;
}

// Crea una canonada real entre dos punts de connexió de dos elements
// diferents, amb la direcció "natural" de cadascun com a punt de partida i
// el nombre mínim de trams que li correspongui.
function createPipe(fromElement, fromRole, fromDir, toElement, toRole, toDir) {
  const segments = minSegmentsFor(fromDir, toDir);
  const freeValues = new Array(Math.max(0, segments - 2)).fill(0.5);
  return buildPipe(fromElement, fromRole, fromDir, toElement, toRole, toDir, segments, freeValues);
}

// Clicar un punt de connexió ja connectat inverteix la direcció (horitzontal
// / vertical) d'aquell extrem de la canonada i li afegeix un tram més
// (vegeu el comentari de capçalera de la secció). Com que dirs es recalcula
// sempre alternant a partir de from.dir, no cal tocar res més perquè la
// nova direcció de l'extrem contrari (to.dir) quedi consistent tota sola.
function togglePipeEndpointDirection(element, role) {
  const pipe = pipes.find((p) => (
    (p.from.element === element && p.from.point === role)
    || (p.to.element === element && p.to.point === role)
  ));
  if (!pipe) return;

  const end = (pipe.from.element === element && pipe.from.point === role) ? pipe.from : pipe.to;
  end.dir = end.dir === 'h' ? 'v' : 'h';
  pipe.segments += 1;
  pipe.freeValues.push(0.5);
  syncPipeHandles(pipe);
  updatePipe(pipe);
  pushHistory();
}

// Permet arrossegar un tram intermedi d'una canonada per ajustar-ne el
// recorregut, movent-se només al llarg de l'eix (x o y) que li pertoca.
function makeHandleDraggable(pipe, handle) {
  let dragging = false;
  let moved = false;

  handle.circle.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    dragging = true;
    moved = false;
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    const a = getConnectionPointPosition(pipe.from.element, pipe.from.point);
    const b = getConnectionPointPosition(pipe.to.element, pipe.to.point);
    const axis = handle.axis;
    if (a[axis] === b[axis]) return;

    moved = true;
    const world = clientToWorld(event.clientX, event.clientY);
    const mouseValue = axis === 'x' ? world.x : world.y;
    // Sense fixar cap límit: si s'arrossega més enllà d'un dels dos
    // extrems (ratio < 0 o > 1), el tram que hi surt d'aquell extrem
    // inverteix la seva direcció en el mateix eix en lloc de quedar-se
    // encallat, ja que buildPipePoints només fa una interpolació lineal
    // entre A i B (vegeu-ne el comentari).
    pipe.freeValues[handle.index] = (mouseValue - a[axis]) / (b[axis] - a[axis]);
    updatePipe(pipe);
  });

  window.addEventListener('mouseup', () => {
    if (dragging && moved) pushHistory();
    dragging = false;
  });
}

// Permet iniciar la creació d'una canonada arrossegant des d'un punt de
// connexió, i canviar la direcció d'un punt que ja té una canonada
// connectada simplement clicant-hi.
function makeConnectable(element) {
  element.querySelectorAll('.connection-point').forEach((point) => {
    // Cal aturar tant "pointerdown" (que és el que arrossega l'element, vegeu
    // makeDraggable) com "mousedown" perquè clicar un punt de connexió no
    // n'inicïi també un arrossegament de l'element sencer.
    point.addEventListener('pointerdown', (event) => event.stopPropagation());
    point.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      if (isPointConnected(element, point.dataset.role)) return;

      const previewPath = document.createElementNS(svgNS, 'path');
      previewPath.classList.add('pipe-path', 'pipe-path--preview');
      viewport.appendChild(previewPath);
      pendingPipe = { fromElement: element, fromRole: point.dataset.role, previewPath };
    });
    point.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!isPointConnected(element, point.dataset.role)) return;
      togglePipeEndpointDirection(element, point.dataset.role);
    });
  });
}

window.addEventListener('mousemove', (event) => {
  if (!pendingPipe) return;
  const a = getConnectionPointPosition(pendingPipe.fromElement, pendingPipe.fromRole);
  const b = clientToWorld(event.clientX, event.clientY);
  pendingPipe.previewPath.setAttribute('d', previewPipePath(a, b));
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
    const fromDir = getNaturalPortDirection(pendingPipe.fromElement, pendingPipe.fromRole);
    const toDir = getNaturalPortDirection(targetElement, targetRole);
    createPipe(pendingPipe.fromElement, pendingPipe.fromRole, fromDir, targetElement, targetRole, toDir);
    pushHistory();
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
  pushHistory();
}

clearAllButton.addEventListener('click', clearAll);

// ---- Copiar / enganxar ----
// El porta-retalls guarda, per a cada element copiat, el suficient per
// recrear-lo (tipus, posició en coordenades de món i estat de
// rotació/mirall/escala), no una referència a l'element original. Així
// "Enganxar" sempre crea instàncies noves, encara que l'element d'origen
// s'hagi eliminat mentrestant.
let clipboard = [];

function copyElements(elements) {
  const list = elements.filter((el) => el.dataset.type !== 'pipe');
  if (!list.length) return;

  clipboard = list.map((el) => {
    const { x, y } = getTranslate(el);
    return {
      type: el.dataset.type,
      x,
      y,
      rotation: el.dataset.rotation,
      flipped: el.dataset.flipped,
      scale: el.dataset.scale,
    };
  });
}

// Enganxa el contingut del porta-retalls mantenint la disposició relativa
// entre els elements copiats: es calcula el centre del conjunt original i
// tots els elements es desplacen pel mateix vector perquè aquest centre
// caigui al punt d'enganxar (worldX, worldY).
function pasteClipboard(worldX, worldY) {
  if (!clipboard.length) return;

  const centerX = clipboard.reduce((sum, entry) => sum + entry.x, 0) / clipboard.length;
  const centerY = clipboard.reduce((sum, entry) => sum + entry.y, 0) / clipboard.length;
  const dx = worldX - centerX;
  const dy = worldY - centerY;

  const pasted = clipboard.map((entry) => {
    const g = createElementInstance(entry.type);
    if (!g) return null;
    g.dataset.rotation = entry.rotation;
    g.dataset.flipped = entry.flipped;
    g.dataset.scale = entry.scale;
    setElementPosition(g, entry.x + dx, entry.y + dy);
    viewport.appendChild(g);
    return g;
  }).filter((g) => g !== null);

  selectMultiple(pasted);
}

// ---- Dreceres de teclat: eliminar / copiar / enganxar ----
// "Suprimir" elimina tota la selecció actual, igual que "Eliminar
// element"/"Suprimir tot" del menú contextual (vegeu buildElementMenuItems
// més avall). Ctrl+C i Ctrl+V fan servir exactament el mateix porta-retalls
// que ja fa servir "Copiar"/"Enganxar" en aquell menú; com que enganxar amb
// teclat no ve d'un clic amb una posició concreta, es desplaça un petit
// vector (PASTE_OFFSET) respecte a la posició original perquè la còpia no
// quedi tapant exactament els elements copiats.
const PASTE_OFFSET = 30;

window.addEventListener('keydown', (event) => {
  if (event.key === 'Delete') {
    if (!selectedElements.size) return;
    event.preventDefault();
    [...selectedElements].forEach(removeElement);
    pushHistory();
    return;
  }

  const ctrlOrCmd = event.ctrlKey || event.metaKey;
  if (!ctrlOrCmd) return;

  if (event.key.toLowerCase() === 'c') {
    if (!selectedElements.size) return;
    event.preventDefault();
    copyElements([...selectedElements]);
    return;
  }

  if (event.key.toLowerCase() === 'v') {
    if (!clipboard.length) return;
    event.preventDefault();
    const centerX = clipboard.reduce((sum, entry) => sum + entry.x, 0) / clipboard.length;
    const centerY = clipboard.reduce((sum, entry) => sum + entry.y, 0) / clipboard.length;
    pasteClipboard(centerX + PASTE_OFFSET, centerY + PASTE_OFFSET);
    pushHistory();
  }
});

// ---- Menú contextual ----
// Construeix la llista d'opcions per a un element concret. Si l'element
// forma part d'una selecció múltiple, les accions individuals (rotar,
// mirall, eliminar) es deixen de banda en favor de "Copiar" (tot el
// conjunt) i "Suprimir tot"; en cas contrari es comporta com abans, amb
// "Rotar 90°"/"Girar (mirall)" només per als tipus que ho admeten
// (ROTATABLE_TYPES / MIRRORABLE_TYPES) i "Copiar"/"Eliminar element" sempre.
function buildElementMenuItems(element) {
  const isMultiSelection = selectedElements.has(element) && selectedElements.size > 1;

  if (isMultiSelection) {
    const selection = [...selectedElements];
    return [
      { label: 'Copiar', action: () => copyElements(selection) },
      { label: 'Suprimir tot', action: () => { selection.forEach(removeElement); pushHistory(); } },
    ];
  }

  const type = element.dataset.type;
  const items = [];

  if (ROTATABLE_TYPES.has(type)) {
    items.push({ label: 'Rotar 90°', action: () => rotateElement(element) });
  }
  if (MIRRORABLE_TYPES.has(type)) {
    items.push({ label: 'Girar (mirall)', action: () => mirrorElement(element) });
  }
  buildRoleMenuItems(element).forEach((item) => items.push(item));
  items.push({ label: 'Copiar', action: () => copyElements([element]) });
  items.push({ label: 'Eliminar element', action: () => { removeElement(element); pushHistory(); } });

  return items;
}

let activeContextMenu = null;

function closeContextMenu() {
  if (!activeContextMenu) return;
  activeContextMenu.remove();
  activeContextMenu = null;
}

function openContextMenu(x, y, items) {
  closeContextMenu();
  if (!items.length) return;

  const menu = document.createElement('ul');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.label;
    li.setAttribute('role', 'menuitem');
    // Enfocable i activable amb teclat, no només amb el ratolí.
    li.tabIndex = 0;
    li.addEventListener('click', (event) => {
      event.stopPropagation();
      item.action();
      closeContextMenu();
    });
    li.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      item.action();
      closeContextMenu();
    });
    menu.appendChild(li);
  });

  document.body.appendChild(menu);
  activeContextMenu = menu;
  // preventScroll perquè obrir el menú no desplaci la barra d'eines.
  menu.firstChild.focus({ preventScroll: true });
}

// Escape tanca el que estigui obert: primer el menú contextual i, si no
// n'hi ha cap, el panell de línies.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (activeContextMenu) {
    closeContextMenu();
    return;
  }
  if (!linesPanel.hidden) {
    closeLinesPanel();
    linesToggle.focus();
  }
});

// Mostra el menú contextual en fer clic dret sobre un element del canvas
// i evita que aparegui el menú per defecte del navegador. Si el clic és
// sobre el fons buit i hi ha alguna cosa al porta-retalls, ofereix
// "Enganxar" a la posició exacta del clic.
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();

  // Si el clic dret interromp un requadre de selecció a mig arrossegar
  // (per exemple perquè s'ha premut el botó dret abans de deixar anar
  // l'esquerre), es cancel·la net: sense això podia quedar penjat al
  // canvas per sempre (vegeu cancelMarquee).
  cancelMarquee();

  const target = event.target.closest('.pid-element');
  if (target) {
    openContextMenu(event.clientX, event.clientY, buildElementMenuItems(target));
    return;
  }

  if (!clipboard.length) {
    closeContextMenu();
    return;
  }

  const world = clientToWorld(event.clientX, event.clientY);
  openContextMenu(event.clientX, event.clientY, [
    { label: 'Enganxar', action: () => { pasteClipboard(world.x, world.y); pushHistory(); } },
  ]);
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

// Treu el requadre de selecció del DOM i deixa d'escoltar-ne
// l'arrossegament, sense seleccionar res. Es fa servir tant per cancel·lar
// un arrossegament interromput (vegeu el "contextmenu" del canvas) com com
// a xarxa de seguretat abans de començar-ne un de nou: així, encara que
// algun cop el "mouseup" no arribi a "window" (per exemple perquè un clic
// dret l'ha interromput pel mig), mai no es pot quedar més d'un requadre
// penjat permanentment al canvas.
function cancelMarquee() {
  if (!marqueeEl) return;
  window.removeEventListener('mousemove', onMarqueeMove);
  window.removeEventListener('mouseup', onMarqueeUp);
  marqueeEl.remove();
  marqueeEl = null;
}

function onMarqueeUp(event) {
  const rect = updateMarqueeVisual(event.clientX, event.clientY);
  cancelMarquee();

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

  // Si per algun motiu ha quedat un requadre d'un arrossegament anterior
  // sense netejar, es treu abans de començar-ne un de nou.
  cancelMarquee();

  clearSelection();
  marqueeStartClient = { x: event.clientX, y: event.clientY };
  marqueeEl = document.createElement('div');
  marqueeEl.className = 'marquee-select';
  document.body.appendChild(marqueeEl);
  updateMarqueeVisual(event.clientX, event.clientY);

  window.addEventListener('mousemove', onMarqueeMove);
  window.addEventListener('mouseup', onMarqueeUp);
});

// ---- Rols de transport (punts de recollida i de consum) ----
// El rol és un atribut més de l'element (data-transport-role /
// data-transport-role-id), com ara la rotació o l'escala: l'element continua
// sent un injector o una tolva a tots els efectes i, sense rol, no canvia
// gens de comportament. No es fa servir el nom "role" a seques perquè al
// projecte ja identifica els punts de connexió (point.dataset.role).
const ROLE_PICKUP = 'pickup';
const ROLE_CONSUMPTION = 'consumption';

// Quin tipus d'element pot rebre cada rol. Com que un tipus només admet un
// dels dos rols, el menú contextual no ha de fer triar mai entre rols.
const ROLE_TYPES = {
  [ROLE_PICKUP]: 'injector',
  [ROLE_CONSUMPTION]: 'hopper',
};

const ROLE_LABELS = {
  [ROLE_PICKUP]: 'Pickup Point',
  [ROLE_CONSUMPTION]: 'Punt de consum',
};

const ROLE_PREFIX = {
  [ROLE_PICKUP]: 'P',
  [ROLE_CONSUMPTION]: 'C',
};

function elementsWithRole(role) {
  return [...viewport.querySelectorAll(`.pid-element[data-transport-role="${role}"]`)];
}

// Menor enter positiu lliure dins del rol demanat: si hi ha l'1 i el 3, el
// següent és el 2. Es calcula recorrent el que hi ha ara al canvas, sense
// cap comptador global, de manera que desfer/refer no el pot desincronitzar.
function nextFreeRoleId(role) {
  const used = new Set(elementsWithRole(role).map((el) => Number(el.dataset.transportRoleId)));
  let id = 1;
  while (used.has(id)) id += 1;
  return id;
}

function assignElementRole(element, role) {
  element.dataset.transportRole = role;
  element.dataset.transportRoleId = String(nextFreeRoleId(role));
  updateRoleBadge(element);
  refreshSelectionFrame(element);
  pushHistory();
}

// En treure un rol, el seu número queda lliure per a un rol futur, però no
// es renumera cap dels altres.
function clearElementRole(element) {
  delete element.dataset.transportRole;
  delete element.dataset.transportRoleId;
  updateRoleBadge(element);
  refreshSelectionFrame(element);
  pushHistory();
}

// Entrades del menú contextual per als tipus que admeten rol (vegeu
// buildElementMenuItems, que és qui les demana).
function buildRoleMenuItems(element) {
  const role = Object.keys(ROLE_TYPES).find((r) => ROLE_TYPES[r] === element.dataset.type);
  if (!role) return [];

  if (element.dataset.transportRole) {
    const current = `${ROLE_LABELS[role]} ${element.dataset.transportRoleId}`;
    return [{ label: `Treure el rol (${current})`, action: () => clearElementRole(element) }];
  }
  return [{ label: `Marcar com a ${ROLE_LABELS[role]}`, action: () => assignElementRole(element, role) }];
}

// Doble clic sobre un element que admet rol: obre les mateixes opcions al
// mateix menú que ja fa servir el clic dret, sense afegir cap patró
// d'interacció nou. El "dblclick" arriba després dels dos "click", que són
// els que tanquen el menú, de manera que el que s'obre aquí no s'autotanca.
function makeRoleEditable(element) {
  element.addEventListener('dblclick', (event) => {
    const items = buildRoleMenuItems(element);
    if (!items.length) return;

    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY, items);
  });
}

// Distintiu "P1"/"C2" dibuixat al costat de l'element. Va dins del mateix
// <g> perquè el segueixi sense cap manteniment (moure, copiar, esborrar,
// desfer), amb una contra-transformació aplicada a setElementPosition
// perquè el text no giri ni s'inverteixi amb la forma.
function updateRoleBadge(element) {
  const role = element.dataset.transportRole;
  let badge = element.querySelector('.role-badge');
  let tip = element.querySelector('title');

  if (!role) {
    if (badge) badge.remove();
    if (tip) tip.remove();
    return;
  }

  if (!badge) {
    badge = document.createElementNS(svgNS, 'text');
    badge.classList.add('role-badge');
    badge.setAttribute('x', -4);
    badge.setAttribute('y', -8);
    element.appendChild(badge);
  }

  // El distintiu es manté curt perquè no tapi l'esquema; el nom sencer del
  // rol s'ofereix com a tooltip natiu de l'SVG en passar-hi per sobre.
  if (!tip) {
    tip = document.createElementNS(svgNS, 'title');
    element.insertBefore(tip, element.firstChild);
  }

  badge.textContent = `${ROLE_PREFIX[role]}${element.dataset.transportRoleId}`;
  tip.textContent = `${ROLE_LABELS[role]} ${element.dataset.transportRoleId}`;
  reapplyElementTransform(element);
}

// ---- Rutes de transport (derivades de la topologia) ----
// Recorregut NO dirigit: encara no hi ha sentit de producte definit, i per
// tant una canonada es pot travessar en qualsevol sentit. El que sí que
// imposa restriccions és la forma de cada element: n'hi ha que només deixen
// passar el producte d'un costat a l'altre, i no entre dos punts del mateix
// costat (vegeu PORT_SIDES). Una ruta és un camí simple (sense repetir
// element ni canonada) que va d'un punt de recollida a un punt de consum
// sense passar per cap altre element amb rol: els punts amb rol són
// terminals. La llista NO es persisteix ni es recalcula sola: és informació
// derivada i només es refà sota demanda.

// Límits de protecció contra explosió combinatòria. Amb bucles i
// desviadores en cascada el nombre de camins simples pot créixer de manera
// exponencial; si se n'assoleix qualsevol, la cerca s'atura de forma
// controlada i el panell ho diu explícitament.
const MAX_PATH_LENGTH = 40;        // elements màxims dins d'un mateix camí
const MAX_PATHS_PER_PAIR = 50;     // camins màxims per parell recollida-consum
const MAX_TOTAL_PATHS = 500;       // camins màxims en total
// Xarxa de seguretat dura sobre la feina feta (no sobre els resultats):
// garanteix que la cerca acaba sempre encara que no trobi cap camí.
const MAX_SEARCH_STEPS = 100000;

// Elements que el producte pot travessar de banda a banda i que, per tant,
// poden quedar enmig d'una ruta. La resta són sempre extrems: encara que
// tinguin més d'un punt de connexió (cicló, esclusa, silo, dosificador...),
// una ruta no hi passa a través. Tenir-ho com a llista explícita, i no
// deduir-ho del nombre de ports, permet ampliar-la quan calgui sense tocar
// l'algoritme.
const TRAVERSABLE_TYPES = new Set(['injector', 'sieve', 'valve', 'diverter']);

// Punts de connexió que comparteixen un mateix costat de l'element, per als
// tipus en què el producte només pot anar d'un costat a l'altre. Dos punts
// del MATEIX grup no comuniquen entre ells: una ruta que entri per un d'ells
// n'ha de sortir per un punt d'un altre grup.
//
// La desviadora és el cas que ho demana. Té un punt sol a un costat
// (`common`) i dos a l'altre (`branch`, la via recta, i `branch2`, la
// desviada), i treballa igual de bé en els dos sentits: dividint (hi entra
// una canonada pel punt comú i en surten dues) o ajuntant (hi entren dues i
// en surt una pel punt comú). Sigui com sigui, el sentit és sempre
// travessant l'element d'un costat a l'altre; el que no pot fer mai és
// passar el producte d'una de les dues branques a l'altra sense passar pel
// punt comú, que és el bypàs que abans s'hi colava i feia aparèixer rutes
// impossibles.
//
// Els grups es donen per rol, no per coordenades: girar l'element (l'únic
// canvi d'orientació que admet, vegeu ROTATABLE_TYPES) en mou els punts però
// no canvia quin és quin, de manera que la restricció val per a qualsevol
// rotació. Els tipus que no surten aquí no tenen cap restricció: qualsevol
// punt comunica amb qualsevol altre, com fins ara.
const PORT_SIDES = {
  diverter: [['common'], ['branch', 'branch2']],
};

// Cert si el producte pot travessar un element d'aquest tipus entrant pel
// punt `fromPort` i sortint pel `toPort`. Un punt que no aparegui a cap grup
// no queda restringit, de manera que afegir un punt de connexió nou a un
// tipus no el pot deixar aïllat per oblit.
function canCrossElement(type, fromPort, toPort) {
  const sides = PORT_SIDES[type];
  if (!sides) return true;

  const fromSide = sides.findIndex((side) => side.includes(fromPort));
  const toSide = sides.findIndex((side) => side.includes(toPort));
  if (fromSide === -1 || toSide === -1) return true;
  return fromSide !== toSide;
}

// Elements cablejats de manera que el producte no hi pot passar: tenen més
// d'una canonada, però totes a punts d'un mateix costat (vegeu PORT_SIDES),
// de manera que cap parella dels seus punts connectats comunica entre ells.
// Abans d'imposar els costats, el recorregut hi passava a través fent el
// bypàs impossible; ara són carrerons sense sortida, i val més dir-ho que
// deixar que les rutes desapareguin sense cap explicació. Amb una sola
// canonada no compta: és un extrem de la instal·lació, no un error.
function findBlockedElements(nodes) {
  const blocked = [];

  nodes.forEach((node) => {
    const type = node.element.dataset.type;
    if (!PORT_SIDES[type]) return;

    const ports = [...node.ports.keys()];
    if (ports.length < 2) return;

    const crosses = ports.some((from, i) => (
      ports.slice(i + 1).some((to) => canCrossElement(type, from, to))
    ));
    if (!crosses) blocked.push(node.element);
  });

  return blocked;
}

// Les canonades no tenen identificador propi, però cada punt de connexió
// només pot allotjar-ne una (vegeu isPointConnected), així que el parell
// ordenat dels seus dos extrems n'és una clau única i estable.
function pipeKey(pipe) {
  const a = `${pipe.from.element.dataset.id}:${pipe.from.point}`;
  const b = `${pipe.to.element.dataset.id}:${pipe.to.point}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Graf d'adjacència per identificador d'element. Cada node guarda, per a
// cada un dels seus punts de connexió ocupats, cap a on porta la canonada.
function buildTopology() {
  const nodes = new Map();
  viewport.querySelectorAll('.pid-element:not(.pipe)').forEach((el) => {
    nodes.set(el.dataset.id, { element: el, ports: new Map() });
  });

  pipes.forEach((pipe) => {
    const fromId = pipe.from.element.dataset.id;
    const toId = pipe.to.element.dataset.id;
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) return;

    const key = pipeKey(pipe);
    from.ports.set(pipe.from.point, { key, otherId: toId, otherPort: pipe.to.point });
    to.ports.set(pipe.to.point, { key, otherId: fromId, otherPort: pipe.from.point });
  });

  return nodes;
}

// Nom visible d'un tipus: es llegeix del botó corresponent de la barra
// d'eines per no duplicar les etiquetes ni arriscar-se que divergeixin.
function typeLabel(type) {
  const button = toolbar.querySelector(`button[data-tool="${type}"]`);
  return button ? button.textContent.trim() : type;
}

// Clau d'un camí concret (no del parell origen-destí): la seqüència
// ordenada d'identificadors d'elements i canonades. Com que el recorregut
// és no dirigit, es normalitza agafant la menor de les dues lectures
// possibles perquè un mateix camí no es pugui comptar dues vegades.
function canonicalPathKey(path) {
  const forward = path.join('>');
  const backward = [...path].reverse().join('>');
  return forward < backward ? forward : backward;
}

function findTransportLines() {
  const nodes = buildTopology();
  const blocked = findBlockedElements(nodes);
  const lines = [];
  const seenPaths = new Set();
  const truncated = { pathLength: false, perPair: false, total: false, steps: false };
  let steps = 0;

  const stopped = () => truncated.total || truncated.steps;
  const roleOf = (id) => nodes.get(id).element.dataset.transportRole || '';
  const typeOf = (id) => nodes.get(id).element.dataset.type;

  const pickups = elementsWithRole(ROLE_PICKUP)
    .sort((a, b) => Number(a.dataset.transportRoleId) - Number(b.dataset.transportRoleId));

  pickups.forEach((startElement) => {
    if (stopped()) return;

    const startId = startElement.dataset.id;
    const pathsPerPair = new Map();
    const visitedElements = new Set([startId]);
    const visitedPipes = new Set();
    const path = [startId];

    function record(endId) {
      const key = canonicalPathKey(path);
      if (seenPaths.has(key)) return;

      const found = pathsPerPair.get(endId) || 0;
      if (found >= MAX_PATHS_PER_PAIR) {
        truncated.perPair = true;
        return;
      }
      if (lines.length >= MAX_TOTAL_PATHS) {
        truncated.total = true;
        return;
      }

      pathsPerPair.set(endId, found + 1);
      seenPaths.add(key);

      // `path` alterna element/canonada; se'n separen les dues llistes
      // perquè la línia guardi el recorregut concret, no només el parell
      // origen-destí (calen per al ressaltat i per a futurs càlculs de
      // longituds i d'equips travessats).
      const pathElementIds = path.filter((_, i) => i % 2 === 0);
      const pathConnectorIds = path.filter((_, i) => i % 2 === 1);

      lines.push({
        key,
        pickupPointId: startId,
        consumptionPointId: endId,
        pickupNumber: Number(startElement.dataset.transportRoleId),
        consumptionNumber: Number(nodes.get(endId).element.dataset.transportRoleId),
        pathElementIds,
        pathConnectorIds,
        pathLabels: pathElementIds.map((id) => typeLabel(nodes.get(id).element.dataset.type)),
      });
    }

    // Recorregut en profunditat. `enteredPort` és el punt de connexió pel
    // qual s'ha arribat a aquest element: no se'n pot tornar a sortir, i
    // només es pot continuar pels altres punts que tinguin canonada. Al
    // node inicial és null perquè encara no s'hi ha entrat per enlloc.
    function walk(nodeId, enteredPort) {
      const ports = [...nodes.get(nodeId).ports.keys()].sort();

      for (const port of ports) {
        if (stopped()) return;
        if (port === enteredPort) continue;
        // Tampoc se'n pot sortir per un punt del mateix costat que aquell
        // pel qual s'hi ha entrat: el producte no travessa l'element d'una
        // branca a l'altra (vegeu PORT_SIDES).
        if (enteredPort !== null && !canCrossElement(typeOf(nodeId), enteredPort, port)) continue;

        steps += 1;
        if (steps > MAX_SEARCH_STEPS) {
          truncated.steps = true;
          return;
        }

        const link = nodes.get(nodeId).ports.get(port);
        if (visitedPipes.has(link.key) || visitedElements.has(link.otherId)) continue;

        path.push(link.key, link.otherId);
        visitedPipes.add(link.key);
        visitedElements.add(link.otherId);

        const nextRole = roleOf(link.otherId);
        if (nextRole === ROLE_CONSUMPTION) {
          record(link.otherId);
        } else if (!nextRole && TRAVERSABLE_TYPES.has(typeOf(link.otherId))) {
          // Sense rol i d'un tipus que es pot travessar: s'hi continua. Un
          // altre punt de recollida seria terminal i no és destí vàlid, i
          // un tipus no travessable tanca el camí aquí mateix.
          if (visitedElements.size > MAX_PATH_LENGTH) {
            truncated.pathLength = true;
          } else {
            walk(link.otherId, link.otherPort);
          }
        }

        path.pop();
        path.pop();
        visitedPipes.delete(link.key);
        visitedElements.delete(link.otherId);
      }
    }

    walk(startId, null);
  });

  // Ordre determinista: dues execucions sobre el mateix P&ID donen
  // exactament la mateixa llista en el mateix ordre.
  lines.sort((a, b) => (
    a.pickupNumber - b.pickupNumber
    || a.consumptionNumber - b.consumptionNumber
    || a.pathElementIds.length - b.pathElementIds.length
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  ));

  // Numeració de les línies i, quan un mateix parell té més d'una ruta,
  // índex de ruta per poder-les distingir a l'etiqueta del panell. Es fa
  // després d'ordenar perquè els números segueixin l'ordre de la llista.
  const routesPerPair = new Map();
  lines.forEach((line) => {
    const pair = `${line.pickupPointId}>${line.consumptionPointId}`;
    routesPerPair.set(pair, (routesPerPair.get(pair) || 0) + 1);
  });

  const routeSeen = new Map();
  lines.forEach((line, index) => {
    const pair = `${line.pickupPointId}>${line.consumptionPointId}`;
    const seen = (routeSeen.get(pair) || 0) + 1;
    routeSeen.set(pair, seen);

    line.id = `line-${index + 1}`;
    line.number = index + 1;
    line.routeIndex = seen;
    line.routeCount = routesPerPair.get(pair);
  });

  return { lines, truncated, blocked };
}

// ---- Ressaltat del recorregut al canvas ----
// El ressaltat és un estat transitori i completament separat de la selecció:
// només afegeix una classe CSS a les canonades i als elements del recorregut,
// sense tocar cap atribut ni estil propi. Per restaurar l'estat visual n'hi
// ha prou de treure la classe d'allà on sigui (no només d'on l'hem posada),
// de manera que no pot quedar-se enganxada.
function clearTransportHighlight() {
  viewport.querySelectorAll('.pipe-path--highlight')
    .forEach((el) => el.classList.remove('pipe-path--highlight'));
  viewport.querySelectorAll('.pid-element--highlight')
    .forEach((el) => el.classList.remove('pid-element--highlight'));
}

function highlightTransportLine(line) {
  clearTransportHighlight();
  if (!line) return;

  const connectors = new Set(line.pathConnectorIds);
  pipes.forEach((pipe) => {
    if (connectors.has(pipeKey(pipe))) pipe.path.classList.add('pipe-path--highlight');
  });

  const elements = new Set(line.pathElementIds);
  viewport.querySelectorAll('.pid-element:not(.pipe)').forEach((el) => {
    if (elements.has(el.dataset.id)) el.classList.add('pid-element--highlight');
  });
}

// Marca al canvas els elements mal cablejats que ha trobat el recàlcul. És
// germana del ressaltat (només afegeix una classe, i treure-la ho deixa tot
// com estava), però amb una vida diferent: no va i ve amb el cursor, sinó
// que es queda fins al recàlcul següent o fins que es tanqui el panell.
// Cridar-la sense arguments és, doncs, la manera d'esborrar-la. Cal perquè
// els elements no porten cap identificador visible: sense la marca, dir-ho
// només de paraula al panell no serviria per trobar-los a l'esquema.
function markBlockedElements(elements = []) {
  viewport.querySelectorAll('.pid-element--blocked')
    .forEach((el) => el.classList.remove('pid-element--blocked'));
  elements.forEach((el) => el.classList.add('pid-element--blocked'));
}

// ---- Panell de línies de transport ----
const linesPanel = document.getElementById('lines-panel');
const linesToggle = document.getElementById('lines-toggle');
const linesClose = document.getElementById('lines-close');
const linesRecalc = document.getElementById('lines-recalc');
const linesList = document.getElementById('lines-list');
const linesNote = document.getElementById('lines-note');

// Línia fixada amb un clic: en treure el cursor d'una entrada es torna al
// seu ressaltat en lloc d'apagar-ho tot. Es descarta a cada recàlcul.
let pinnedLine = null;

function renderTransportLines() {
  pinnedLine = null;
  clearTransportHighlight();

  const { lines, truncated, blocked } = findTransportLines();
  const notes = [];
  markBlockedElements(blocked);

  if (!elementsWithRole(ROLE_PICKUP).length) {
    notes.push(`Cap ${ROLE_LABELS[ROLE_PICKUP]} definit.`);
  }
  if (!elementsWithRole(ROLE_CONSUMPTION).length) {
    notes.push(`Cap ${ROLE_LABELS[ROLE_CONSUMPTION].toLowerCase()} definit.`);
  }
  if (!notes.length && !lines.length) {
    notes.push('No s\'ha trobat cap ruta entre els punts definits.');
  }
  if (truncated.pathLength || truncated.perPair || truncated.total || truncated.steps) {
    notes.push('S\'ha assolit un límit intern de cerca: la llista pot ser incompleta.');
  }

  // De quins tipus són: ara mateix només hi poden sortir desviadores, però
  // la comprovació és general i el nom es llegeix de la barra d'eines.
  if (blocked.length) {
    const kinds = [...new Set(blocked.map((el) => typeLabel(el.dataset.type).toLowerCase()))];
    notes.push(blocked.length === 1
      ? `1 element (${kinds.join(', ')}) té totes les canonades al mateix costat: el producte no hi pot passar. Queda marcat al canvas.`
      : `${blocked.length} elements (${kinds.join(', ')}) tenen totes les canonades al mateix costat: el producte no hi pot passar. Queden marcats al canvas.`);
  }

  linesNote.textContent = notes.join(' ');
  linesNote.hidden = notes.length === 0;

  // La llista es reconstrueix sencera: cap línia obsoleta pot sobreviure.
  linesList.replaceChildren();

  lines.forEach((line) => {
    const item = document.createElement('li');

    // Cada entrada és un <button> de debò: així es pot recórrer amb el
    // tabulador i activar amb Enter o Espai sense simular res a mà, i el
    // lector de pantalla l'anuncia com el control que és.
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'line-item';
    control.setAttribute('aria-pressed', 'false');

    const title = document.createElement('span');
    title.className = 'line-item__title';

    const number = document.createElement('span');
    number.className = 'line-item__number';
    number.textContent = `Línia ${line.number}`;

    const pair = document.createElement('span');
    pair.className = 'line-item__pair';
    pair.textContent = `${ROLE_LABELS[ROLE_PICKUP]} ${line.pickupNumber} → ${ROLE_LABELS[ROLE_CONSUMPTION]} ${line.consumptionNumber}`;
    // Diverses rutes per al mateix parell: cal poder distingir-les.
    if (line.routeCount > 1) {
      pair.textContent += ` (ruta ${line.routeIndex}/${line.routeCount})`;
    }

    title.append(number, pair);

    const detail = document.createElement('span');
    detail.className = 'line-item__path';
    const count = line.pathConnectorIds.length;
    detail.textContent = `${line.pathLabels.join(' › ')} · ${count === 1 ? '1 canonada' : `${count} canonades`}`;

    control.append(title, detail);

    // El ressaltat respon tant al ratolí com al focus del teclat, perquè
    // qui navega amb el tabulador vegi el recorregut igual que qui hi passa
    // el cursor per sobre.
    const show = () => highlightTransportLine(line);
    const restore = () => highlightTransportLine(pinnedLine);
    control.addEventListener('mouseenter', show);
    control.addEventListener('focus', show);
    control.addEventListener('mouseleave', restore);
    control.addEventListener('blur', restore);

    control.addEventListener('click', () => {
      pinnedLine = pinnedLine === line ? null : line;
      linesList.querySelectorAll('.line-item').forEach((el) => {
        el.classList.remove('is-pinned');
        el.setAttribute('aria-pressed', 'false');
      });
      if (pinnedLine) {
        control.classList.add('is-pinned');
        control.setAttribute('aria-pressed', 'true');
      }
      highlightTransportLine(pinnedLine || line);
    });

    item.appendChild(control);
    linesList.appendChild(item);
  });
}

// El recàlcul és sempre explícit: obrir el panell i el botó "Recalcular"
// són les úniques maneres de refer la llista. No hi ha cap observador sobre
// el canvas, de manera que editar l'esquema amb el panell obert deixa la
// llista tal com estava fins que es torni a demanar.
function closeLinesPanel() {
  linesPanel.hidden = true;
  linesToggle.setAttribute('aria-expanded', 'false');
  pinnedLine = null;
  clearTransportHighlight();
  markBlockedElements();
}

linesToggle.addEventListener('click', () => {
  if (linesPanel.hidden) {
    linesPanel.hidden = false;
    linesToggle.setAttribute('aria-expanded', 'true');
    renderTransportLines();
  } else {
    closeLinesPanel();
  }
});

linesClose.addEventListener('click', () => {
  closeLinesPanel();
  linesToggle.focus();
});

linesRecalc.addEventListener('click', renderTransportLines);

// ---- Desfer / Refer ----
// Pila de captures completes de l'estat (tots els elements i canonades),
// preses després de cada acció completa de l'usuari (afegir, moure, rotar,
// connectar/desconnectar una canonada...), mai durant l'arrossegament en si
// (vegeu els `pushHistory()` escampats per les funcions anteriors). Desfer/
// refer reconstrueix el canvas sencer a partir de la captura corresponent
// en lloc de desfer cada acció una a una: és més senzill i robust, encara
// que això vol dir que la selecció es perd en cada desfer/refer. Com a
// qualsevol historial d'aquest estil, fer una acció nova després d'un
// desfer descarta el "futur" (les captures per davant de l'índex actual).
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 200;

// Cada element es desa amb la seva posició (que viu a l'atribut transform)
// i amb TOT el seu dataset tal com és, no amb una llista fixa de camps.
// Això és el que fa que el format aguanti els canvis futurs del programa:
// qualsevol data-* nou que s'afegeixi als elements (un codi d'equip, un
// cabal, un color...) queda desat i restaurat sol, tant a l'historial de
// desfer/refer com als arxius .pid.json, sense tocar aquestes funcions.
function serializeState() {
  const elements = [];
  viewport.querySelectorAll('.pid-element:not(.pipe)').forEach((el) => {
    const { x, y } = getTranslate(el);
    elements.push({ x, y, data: { ...el.dataset } });
  });

  const pipesData = pipes.map((pipe) => ({
    fromId: pipe.from.element.dataset.id,
    fromRole: pipe.from.point,
    fromDir: pipe.from.dir,
    toId: pipe.to.element.dataset.id,
    toRole: pipe.to.point,
    toDir: pipe.to.dir,
    segments: pipe.segments,
    freeValues: [...pipe.freeValues],
  }));

  return { elements, pipes: pipesData, elementCount };
}

// Accepta tant el format actual ({ x, y, data }) com el que feien servir
// les captures antigues (camps solts). Tenir-ho aquí, i no a la capa
// d'arxius, vol dir que qualsevol arxiu desat amb una versió anterior del
// programa es continua obrint sense migracions especials.
function normalizeElementEntry(entry) {
  if (entry.data) return entry;

  const data = {
    id: entry.id,
    type: entry.type,
    rotation: entry.rotation,
    flipped: entry.flipped,
    scale: entry.scale,
  };
  if (entry.role) {
    data.transportRole = entry.role;
    data.transportRoleId = entry.roleId;
  }
  return { x: entry.x, y: entry.y, data };
}

// Reconstrueix el canvas sencer a partir d'una captura (vegeu
// serializeState): primer tots els elements (amb el seu identificador
// original, perquè les canonades els puguin retrobar), després les
// canonades que els connecten. Tot el que ve de fora (un arxiu que pot
// haver estat desat per una versió més antiga o més nova del programa) es
// tracta com a dubtós: si un element és d'un tipus que ja no existeix, o
// una canonada apunta a un punt de connexió que ja no hi és, es descarta
// només aquella peça i la resta del model s'obre igualment.
function restoreState(state) {
  pipes.length = 0;
  viewport.replaceChildren();
  clearSelection();

  const byId = new Map();
  let maxIdNumber = 0;

  (state.elements || []).forEach((raw) => {
    const entry = normalizeElementEntry(raw);
    const g = buildBareElement(entry.data.type);
    if (!g) return;

    Object.assign(g.dataset, entry.data);
    setElementPosition(g, entry.x, entry.y);
    updateRoleBadge(g);
    viewport.appendChild(g);
    byId.set(g.dataset.id, g);

    // Els identificadors són del tipus "valve-7": es guarda el número més
    // alt per no reutilitzar-lo mai en un element nou (vegeu més avall).
    const idNumber = Number(String(g.dataset.id).split('-').pop());
    if (Number.isFinite(idNumber)) maxIdNumber = Math.max(maxIdNumber, idNumber);
  });

  (state.pipes || []).forEach((p) => {
    const fromElement = byId.get(p.fromId);
    const toElement = byId.get(p.toId);
    if (!fromElement || !toElement) return;

    const fromOffsets = connectionOffsets[fromElement.dataset.type];
    const toOffsets = connectionOffsets[toElement.dataset.type];
    if (!fromOffsets || !fromOffsets[p.fromRole]) return;
    if (!toOffsets || !toOffsets[p.toRole]) return;

    // Si l'arxiu no porta direccions o trams (o en porta menys dels
    // mínims), es recalculen com si la canonada s'acabés de crear.
    const fromDir = p.fromDir || getNaturalPortDirection(fromElement, p.fromRole);
    const toDir = p.toDir || getNaturalPortDirection(toElement, p.toRole);
    const segments = Math.max(Number(p.segments) || 0, minSegmentsFor(fromDir, toDir));
    const freeValues = Array.isArray(p.freeValues) ? [...p.freeValues] : [];
    while (freeValues.length < segments - 2) freeValues.push(0.5);

    buildPipe(fromElement, p.fromRole, fromDir, toElement, p.toRole, toDir, segments, freeValues);
  });

  // El comptador mai no pot quedar per sota del número d'identificador més
  // alt que hi ha al canvas: si ho fes, un element nou en reutilitzaria un
  // i les canonades es confondrien en desar i tornar a obrir.
  elementCount = Math.max(Number(state.elementCount) || 0, maxIdNumber);
}

function updateHistoryButtons() {
  undoButton.disabled = historyIndex <= 0;
  redoButton.disabled = historyIndex >= history.length - 1;
}

// Es crida després de cada acció completa de l'usuari. Descarta qualsevol
// "futur" (captures per davant de l'índex actual) si es venia de fer un o
// més "Desfer": una acció nova sempre substitueix el que s'hauria pogut
// refer.
function pushHistory() {
  const snapshot = serializeState();
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  restoreState(history[historyIndex]);
  updateHistoryButtons();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  restoreState(history[historyIndex]);
  updateHistoryButtons();
}

undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);

// ---- Desar i obrir models (.pid.json) ----
// L'arxiu és JSON pla i porta sempre tres coses: qui l'ha escrit (`format`),
// amb quina versió de format (`version`) i l'estat sencer (`state`, la
// mateixa captura que fa servir desfer/refer, vegeu serializeState). Que
// sigui exactament la mateixa captura és el que garanteix que el que es
// desa i el que es torna a obrir siguin idèntics: no hi ha dues llistes de
// camps que puguin acabar divergint.
//
// Com evoluciona el format sense trencar els arxius que ja hi ha:
//   · Afegir un data-* nou a un element o una propietat nova a una
//     canonada NO demana tocar res: es desa i es restaura sol, i els
//     arxius vells simplement no el porten (restoreState fa servir el
//     valor per defecte que toqui).
//   · Un canvi que sí que trenqui la compatibilitat (reanomenar un tipus
//     d'element, canviar el significat d'un camp...) demana pujar
//     FILE_VERSION i afegir una funció a MODEL_MIGRATIONS que porti un
//     arxiu de la versió anterior a la nova. migrateModel les encadena
//     totes, de manera que un arxiu de la versió 1 s'obre igual de bé
//     quan el programa vagi per la 5.
//   · Un arxiu d'una versió MÉS NOVA que la del programa s'intenta obrir
//     igualment (el format només creix), avisant que pot faltar-hi coses.
const FILE_FORMAT = 'pid-editor-model';
const FILE_VERSION = 2;
const FILE_EXTENSION = '.pid.json';

const MODEL_MIGRATIONS = {
  // v1 → v2: els punts de connexió de la desviadora es deien input/output/
  // output2, com si tingués un sentit de flux fix. Ara es diuen common/
  // branch/branch2 (vegeu connectionOffsets), que és el que són de debò. Cal
  // reanomenar-los a les canonades dels arxius antics: si no, restoreState
  // no trobaria aquells punts i descartaria, en silenci, totes les canonades
  // connectades a una desviadora.
  1: (model) => {
    const renamed = { input: 'common', output: 'branch', output2: 'branch2' };

    // Només les desviadores: a la resta de tipus, input/output/output2
    // continuen sent els noms bons.
    const diverters = new Set();
    (model.state.elements || []).forEach((raw) => {
      const entry = normalizeElementEntry(raw);
      if (entry.data.type === 'diverter') diverters.add(entry.data.id);
    });

    (model.state.pipes || []).forEach((pipe) => {
      if (diverters.has(pipe.fromId) && renamed[pipe.fromRole]) {
        pipe.fromRole = renamed[pipe.fromRole];
      }
      if (diverters.has(pipe.toId) && renamed[pipe.toRole]) {
        pipe.toRole = renamed[pipe.toRole];
      }
    });

    return model;
  },
};

const saveModelButton = document.getElementById('save-model');
const fileNote = document.getElementById('file-note');

// Arxiu on desa el botó "Desa". Es recorda durant la sessió: el primer cop
// es tria (o es descarrega) i, a partir d'aquí, desar hi torna a escriure
// a sobre sense preguntar res. Obrir un model arrossegant-lo també l'apunta
// aquí, de manera que després es pot desar directament sobre el mateix
// arxiu d'on venia.
let modelFileHandle = null;

function setFileNote(message, isError = false) {
  fileNote.textContent = message;
  fileNote.hidden = !message;
  fileNote.classList.toggle('toolbar-note--error', Boolean(isError));
}

function defaultFileName() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `model-${stamp}${FILE_EXTENSION}`;
}

function buildModelFile() {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    // La vista es desa a part de l'estat: obrir un arxiu recupera
    // l'enquadrament (pan i zoom) que tenia quan es va desar, però
    // desfer/refer, que fan servir només `state`, no la mouen mai.
    view: { x: viewX, y: viewY, scale: viewScale },
    state: serializeState(),
  };
}

function migrateModel(model) {
  let current = model;
  let version = Number(current.version) || 1;

  while (version < FILE_VERSION) {
    const migrate = MODEL_MIGRATIONS[version];
    // Sense camí de migració es prova d'obrir l'arxiu tal com és: val més
    // intentar-ho (restoreState és tolerant) que negar-s'hi en sec.
    if (!migrate) break;
    current = migrate(current);
    version += 1;
    current.version = version;
  }

  return current;
}

// Comprova, obre i deixa el model al canvas. Llança un error amb un text
// pensat per ensenyar-lo tal qual si l'arxiu no serveix.
function applyModelFile(text) {
  let model;
  try {
    model = JSON.parse(text);
  } catch {
    throw new Error('L\'arxiu no es pot llegir: no és un JSON vàlid.');
  }

  if (!model || model.format !== FILE_FORMAT) {
    throw new Error('L\'arxiu no és un model de l\'Editor P&ID.');
  }
  if (!model.state || !Array.isArray(model.state.elements)) {
    throw new Error('L\'arxiu no conté cap model.');
  }

  const newer = (Number(model.version) || 1) > FILE_VERSION;
  const migrated = migrateModel(model);

  // Xarxa de seguretat: restaurar és destructiu (buida el canvas abans de
  // reconstruir-lo). Si l'arxiu peta a mig obrir, es torna exactament al
  // que hi havia en lloc de deixar l'usuari amb el canvas a mitges.
  const backup = serializeState();
  try {
    restoreState(migrated.state);
  } catch {
    restoreState(backup);
    throw new Error('L\'arxiu està malmès: no s\'ha pogut obrir (el canvas no s\'ha tocat).');
  }

  if (migrated.view) {
    viewX = Number(migrated.view.x) || 0;
    viewY = Number(migrated.view.y) || 0;
    const scale = Number(migrated.view.scale) || 1;
    viewScale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
    applyViewport();
  }

  // Obrir un model és una acció més: es pot desfer i es torna al que hi
  // havia abans al canvas.
  pushHistory();

  return { newer };
}

// ---- Desar ----
// Amb l'API d'accés a arxius (Chrome/Edge) el botó escriu de debò sobre
// l'arxiu triat, i el navegador recorda l'última carpeta que s'hi va fer
// servir (`id`), de manera que a partir del primer cop desar és un sol
// clic. On aquesta API no hi és (Firefox, Safari), es descarrega l'arxiu
// com sempre, que és el màxim que una pàgina web pot fer tota sola.
async function ensureWritePermission(handle) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

function downloadModelFile(json, name) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function saveModel() {
  const json = JSON.stringify(buildModelFile(), null, 2);

  if (window.showSaveFilePicker) {
    try {
      if (!modelFileHandle) {
        modelFileHandle = await window.showSaveFilePicker({
          // Amb un `id` fix, el navegador torna a obrir el diàleg a la
          // carpeta que es va fer servir l'últim cop.
          id: 'pid-editor-model',
          suggestedName: defaultFileName(),
          types: [{
            description: 'Model Editor P&ID',
            accept: { 'application/json': [FILE_EXTENSION] },
          }],
        });
      }

      if (!(await ensureWritePermission(modelFileHandle))) {
        setFileNote('No s\'ha pogut desar: permís d\'escriptura denegat.', true);
        return;
      }

      const writable = await modelFileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      setFileNote(`Desat a ${modelFileHandle.name}`);
      return;
    } catch (error) {
      // Cancel·lar el diàleg no és cap error: no s'ha de dir res.
      if (error && error.name === 'AbortError') return;
      // Qualsevol altre problema (permís revocat, arxiu mogut...): es
      // descarta l'arxiu recordat i es descarrega, que sempre funciona.
      modelFileHandle = null;
    }
  }

  downloadModelFile(json, defaultFileName());
  setFileNote('Model descarregat a la carpeta de descàrregues.');
}

saveModelButton.addEventListener('click', saveModel);

// Ctrl+S / Cmd+S desa igual que el botó (i no deixa que el navegador obri
// el seu "desa la pàgina").
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  saveModel();
});

// ---- Obrir arrossegant l'arxiu sobre el canvas ----
async function openDroppedFile(file, handle) {
  try {
    const { newer } = applyModelFile(await file.text());
    // Si el navegador ens ha donat accés d'escriptura a l'arxiu arrossegat,
    // el botó "Desa" hi tornarà a escriure a sobre directament.
    modelFileHandle = handle || null;
    setFileNote(newer
      ? `Obert ${file.name} (desat amb una versió més nova: pot faltar-hi alguna cosa).`
      : `Obert ${file.name}`);
  } catch (error) {
    setFileNote(error.message, true);
  }
}

function hasFiles(event) {
  return Boolean(event.dataTransfer) && [...event.dataTransfer.types].includes('Files');
}

['dragenter', 'dragover'].forEach((type) => {
  canvasContainer.addEventListener(type, (event) => {
    if (!hasFiles(event)) return;
    // Cal aturar el comportament per defecte a cada dragover perquè el
    // navegador accepti el "drop" en lloc d'obrir l'arxiu ell mateix.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    canvasContainer.classList.add('drop-target');
  });
});

canvasContainer.addEventListener('dragleave', (event) => {
  // Passar per sobre d'un element de dins del canvas també dispara
  // "dragleave": només compta sortir del contenidor de debò.
  if (event.relatedTarget && canvasContainer.contains(event.relatedTarget)) return;
  canvasContainer.classList.remove('drop-target');
});

canvasContainer.addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  canvasContainer.classList.remove('drop-target');

  const item = event.dataTransfer.items && event.dataTransfer.items[0];
  const file = event.dataTransfer.files[0];
  if (!file) return;

  // getAsFileSystemHandle (Chrome/Edge) dona un identificador d'arxiu de
  // debò, no només una còpia de lectura: és el que permet que després
  // "Desa" escrigui sobre el mateix arxiu que s'ha arrossegat.
  let handle = null;
  if (item && item.getAsFileSystemHandle) {
    try {
      handle = await item.getAsFileSystemHandle();
    } catch {
      handle = null;
    }
  }

  openDroppedFile(file, handle);
});

// Deixar anar un arxiu fora del canvas no ha de fer que el navegador hi
// navegui i es perdi la feina no desada.
window.addEventListener('dragover', (event) => {
  if (hasFiles(event) && !canvasContainer.contains(event.target)) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (hasFiles(event) && !canvasContainer.contains(event.target)) event.preventDefault();
});

// Captura inicial (canvas buit), perquè hi hagi alguna cosa a la qual
// tornar amb "Desfer" just després de la primera acció.
pushHistory();
