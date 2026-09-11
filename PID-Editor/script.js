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

// Capa on es dibuixa la simulació (barres de nivell i flux de producte).
// És GERMANA del viewport, no filla, per dues raons: així el que hi ha
// dibuixat no entra a viewport.getBBox() (i per tant no desquadra
// "Enquadra-ho tot"), i es pot buidar sencera sense tocar el diagrama.
// Porta el mateix transform que el viewport, que li posa applyViewport().
const simOverlay = document.createElementNS(svgNS, 'g');
simOverlay.id = 'sim-overlay';
canvas.appendChild(simOverlay);

let viewX = 0;
let viewY = 0;
let viewScale = 1;

const MIN_VIEW_SCALE = 0.2;
const MAX_VIEW_SCALE = 4;
const GRID_SIZE = 20;

// Separació de la malla de punts del fons, en píxels de pantalla. Quan el
// zoom deixaria els punts massa junts, es dobla: com que es DOBLA (i no un
// factor qualsevol), els punts que queden són sempre un subconjunt dels
// mateixos i, per tant, continuen clavats al contingut.
const MIN_DOT_SPACING = 11;

function dotSpacing() {
  let spacing = GRID_SIZE * viewScale;
  while (spacing < MIN_DOT_SPACING) spacing *= 2;
  return spacing;
}

function applyViewport() {
  const transform = `translate(${viewX}, ${viewY}) scale(${viewScale})`;
  viewport.setAttribute('transform', transform);
  simOverlay.setAttribute('transform', transform);
  // Les etiquetes de les barres van a mida fixa de pantalla: el seu
  // contra-escalat depèn del zoom i s'ha de refer en canviar-lo.
  updateSimLabelScale();
  // La malla de punts del fons és CSS, no SVG: cal moure-la i espaiar-la a
  // mà perquè continuï alineada amb el contingut.
  const spacing = dotSpacing();
  canvasContainer.style.backgroundSize = `${spacing}px ${spacing}px`;
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
  makeElementEditable(g);
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
  closeToolMenus();
});

// ---- Menús de categoria de la barra d'eines ----
// Cada categoria obre el seu menú en comptes de tenir tots els seus
// elements permanentment a la vista. Els botons [data-tool] continuen
// vivint dins de .tool-groups encara que el menú estigui amagat, de manera
// que la delegació de clics de just aquí sobre i typeLabel() no han de
// saber res d'aquests menús.
const toolGroups = [...document.querySelectorAll('.tool-group')];

function closeToolMenus(except) {
  toolGroups.forEach((group) => {
    if (group === except) return;
    group.querySelector('.tool-group__trigger').setAttribute('aria-expanded', 'false');
    group.querySelector('.tool-group__menu').hidden = true;
  });
}

toolGroups.forEach((group) => {
  const trigger = group.querySelector('.tool-group__trigger');
  const menu = group.querySelector('.tool-group__menu');

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const opening = menu.hidden;
    // Només un menú obert alhora: obrir-ne un tanca els altres.
    closeToolMenus(group);
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
  });
});

// Clicar fora o prémer Escape tanca el que hi hagi obert, com qualsevol
// altre menú de l'aplicació.
window.addEventListener('mousedown', (event) => {
  if (!event.target.closest('.tool-group')) closeToolMenus();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeToolMenus();
});

// Elimina un element del canvas. Si és un dipòsit, bomba o vàlvula,
// també elimina qualsevol canonada que hi estigui connectada perquè
// no en quedi cap despenjada.
function removeElement(element) {
  if (element.dataset.type === 'pipe') {
    removePipe(element);
    return;
  }

  // La fitxa de procés no es pot quedar oberta sobre un element que ja no
  // hi és. La configuració SÍ que es queda al model: si es desfà
  // l'eliminació, l'element torna amb tot el que tenia configurat.
  closeProcessPanelFor(element.dataset.id);

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
  // El comptador d'identificadors torna a zero i, per tant, un element nou
  // podria rebre l'identificador d'un dels que s'acaben d'esborrar. El
  // model de procés va indexat per aquest identificador, així que s'ha de
  // buidar alhora que el canvas per no heretar fitxes d'un model anterior.
  ProcessModel.clear();
  closeProcessPanel();
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

// ---- Controls de navegació del canvas ----
// Fan el mateix que la roda del ratolí, però prenent com a punt fix el
// centre de la vista en lloc del cursor: és el que s'espera d'un botó.
function zoomBy(factor) {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const worldX = (centerX - viewX) / viewScale;
  const worldY = (centerY - viewY) / viewScale;

  viewScale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, viewScale * factor));
  viewX = centerX - worldX * viewScale;
  viewY = centerY - worldY * viewScale;
  applyViewport();
}

// Enquadra tot el que hi ha dibuixat. La caixa la dona el mateix SVG
// (getBBox del grup que conté tot el contingut), de manera que no cal
// repassar element per element ni saber res de la forma de cadascun; com
// que es demana al grup ABANS del seu transform, ja ve en coordenades de
// món, que és el que necessiten viewX/viewY.
function zoomToFit() {
  if (!viewport.childNodes.length) return;

  const box = viewport.getBBox();
  if (!box.width || !box.height) return;

  const rect = canvas.getBoundingClientRect();
  const margin = 56;
  const scale = Math.min(
    (rect.width - margin * 2) / box.width,
    (rect.height - margin * 2) / box.height,
  );

  viewScale = Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
  viewX = rect.width / 2 - (box.x + box.width / 2) * viewScale;
  viewY = rect.height / 2 - (box.y + box.height / 2) * viewScale;
  applyViewport();
}

document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.2));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
document.getElementById('zoom-fit').addEventListener('click', zoomToFit);

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
const ROLE_STORAGE = 'storage';

// Quins tipus d'element poden rebre cada rol. Un mateix tipus pot sortir a
// més d'una llista (la tolva filtre pot ser punt de consum O element
// d'emmagatzematge), però un element concret només pot tenir un rol alhora:
// vegeu requestRoleChange, que avisa abans de substituir-ne un.
const ROLE_TYPES = {
  [ROLE_PICKUP]: ['injector'],
  [ROLE_CONSUMPTION]: ['hopper'],
  // El silo és l'element d'emmagatzematge dedicat que ja tenia el programa;
  // la descàrrega de sacs fa de magatzem a tots els efectes, i les tolves
  // poden fer-ne totes (la filtre, quan no fa de punt de consum). Un cop
  // marcades com a magatzem passen a ser terminals del recorregut, com
  // qualsevol element amb rol: cap ruta no hi passa a través.
  [ROLE_STORAGE]: ['silo', 'bagdump', 'hopper', 'gravityhopper', 'trouserhopper'],
};

const ROLE_LABELS = {
  [ROLE_PICKUP]: 'Pickup Point',
  [ROLE_CONSUMPTION]: 'Punt de consum',
  [ROLE_STORAGE]: 'Element d\'emmagatzematge',
};

const ROLE_PREFIX = {
  [ROLE_PICKUP]: 'P',
  [ROLE_CONSUMPTION]: 'C',
  [ROLE_STORAGE]: 'S',
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

// Rols que admet un tipus d'element. Poden ser més d'un (vegeu ROLE_TYPES).
function rolesForType(type) {
  return Object.keys(ROLE_TYPES).filter((role) => ROLE_TYPES[role].includes(type));
}

// Un element no pot tenir dos rols alhora. Substituir-ne un canvia què és
// l'element dins de la instal·lació i quina fitxa de procés se li demana,
// així que no es fa en silenci: es demana confirmació primer.
function requestRoleChange(element, role) {
  const current = element.dataset.transportRole;

  if (current && current !== role) {
    const currentName = `${ROLE_LABELS[current]} ${element.dataset.transportRoleId}`;
    const accepted = window.confirm(
      `Aquest element ja és ${currentName}.\n\n`
      + 'Un element només pot tenir un rol alhora: si el marques com a '
      + `${ROLE_LABELS[role]}, deixarà de ser ${ROLE_LABELS[current]}.`,
    );
    if (!accepted) return;
  }

  assignElementRole(element, role);
}

// Entrades del menú contextual per als tipus que admeten rol (vegeu
// buildElementMenuItems, que és qui les demana).
function buildRoleMenuItems(element) {
  const roles = rolesForType(element.dataset.type);
  if (!roles.length) return [];

  const current = element.dataset.transportRole;
  const items = [];

  if (current) {
    const name = `${ROLE_LABELS[current]} ${element.dataset.transportRoleId}`;
    items.push({ label: `Treure el rol (${name})`, action: () => clearElementRole(element) });
  }

  roles.filter((role) => role !== current).forEach((role) => {
    items.push({
      label: `Marcar com a ${ROLE_LABELS[role]}`,
      action: () => requestRoleChange(element, role),
    });
  });

  return items;
}

// Doble clic sobre un element:
//   · si ja té un rol, obre la seva fitxa de procés (producte, quantitats,
//     capacitat... segons el rol);
//   · si no en té però en podria tenir, obre les opcions de rol al mateix
//     menú que ja fa servir el clic dret, exactament com abans.
// El "dblclick" arriba després dels dos "click", que són els que tanquen el
// menú, de manera que el que s'obre aquí no s'autotanca.
function makeElementEditable(element) {
  element.addEventListener('dblclick', (event) => {
    if (element.dataset.transportRole) {
      event.preventDefault();
      event.stopPropagation();
      openElementProcessPanel(element);
      return;
    }

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

// D'aquests tipus, els que el producte travessa ENCARA QUE tinguin un rol
// assignat. Només l'injector: injecta el seu propi producte al corrent
// d'aire, però no l'atura, de manera que per a una línia que hi passa pel
// mig és un tram de canonada i res més.
//
// Això és el que fa que dos injectors en sèrie donin dues línies i no una:
// la del segon (que arriba al punt de consum pel seu compte) i la del
// primer, que travessa el segon fins al mateix punt de consum. Sense
// aquesta excepció, el primer es quedava sense línia perquè el segon, en
// ser punt de recollida, li tancava el camí.
//
// Compte: això val NOMÉS per a les línies de transport. La cerca de
// l'element d'emmagatzematge aigües amunt (vegeu findUpstreamStorage a
// process.js) continua tractant qualsevol element amb rol com a final de
// recorregut, i ha de continuar sent així: el magatzem que alimenta el
// segon injector no és el que alimenta el primer.
const TRAVERSABLE_WITH_ROLE_TYPES = new Set(['injector']);

// Cert si una ruta pot continuar a través d'aquest element.
function canPassThrough(type, role) {
  if (!TRAVERSABLE_TYPES.has(type)) return false;
  return !role || TRAVERSABLE_WITH_ROLE_TYPES.has(type);
}

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
        } else if (canPassThrough(typeOf(link.otherId), nextRole)) {
          // S'hi continua. El punt de consum d'abans és l'únic destí vàlid;
          // un punt de recollida que es trobi pel mig no és mai destí, però
          // sí que es pot travessar si és d'un tipus que ho permet (vegeu
          // TRAVERSABLE_WITH_ROLE_TYPES). Un tipus no travessable, o un
          // element amb rol que no sigui d'aquests, tanca el camí aquí.
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
const orphanLines = document.getElementById('orphan-lines');
const orphanList = document.getElementById('orphan-list');

// Línia fixada amb un clic: en treure el cursor d'una entrada es torna al
// seu ressaltat en lloc d'apagar-ho tot. Es descarta a cada recàlcul.
let pinnedLine = null;

// Resultat de l'últim recàlcul. Es guarda a part perquè el panell es pugui
// tornar a pintar sense refer la detecció: desar la configuració d'una
// línia n'ha de canviar el text, però no quines línies hi ha ni en quin
// ordre surten (això només ho decideix el recàlcul, que és explícit).
let lastLinesResult = { lines: [], truncated: {}, blocked: [] };

function renderTransportLines() {
  pinnedLine = null;
  clearTransportHighlight();
  lastLinesResult = findTransportLines();
  paintLinesPanel();
}

function paintLinesPanel() {
  const { lines, truncated, blocked } = lastLinesResult;
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

    // Tercera fila: la configuració de procés de la línia, o l'avís que
    // encara no en té. La signatura (i no el número de línia, que canvia)
    // és el que lliga la línia detectada amb la seva configuració.
    const signature = ProcessModel.lineSignature(line);
    const setup = document.createElement('span');
    setup.className = 'line-item__setup';

    if (ProcessModel.hasLine(signature)) {
      const config = ProcessModel.getLine(signature);
      setup.textContent = [
        config.name || 'Sense nom',
        `${config.throughput} kg/h`,
        `Ø ${config.diameter} mm`,
        `${config.length} m`,
      ].join(' · ');
    } else {
      setup.classList.add('line-item__setup--empty');
      setup.textContent = 'Sense configurar';
    }

    control.append(title, detail, setup);
    control.title = 'Doble clic per configurar la línia';

    // Doble clic per obrir la fitxa. Els dos "click" que l'acompanyen fan
    // i desfan la fixació del ressaltat, de manera que l'estat final és el
    // mateix que hi havia abans i no cal tractar-los a part.
    control.addEventListener('dblclick', (event) => {
      event.preventDefault();
      openLineProcessPanel(line);
    });

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

    // En repintar (per exemple, després de desar una configuració) la línia
    // que estava fixada ho ha de continuar estant: els objectes `line` són
    // els mateixos mentre no hi hagi un recàlcul nou.
    if (pinnedLine === line) {
      control.classList.add('is-pinned');
      control.setAttribute('aria-pressed', 'true');
    }

    item.appendChild(control);
    linesList.appendChild(item);
  });

  paintOrphanLines(lines.map((line) => ProcessModel.lineSignature(line)));
}

// Configuracions de línia que ara mateix no corresponen a cap línia
// detectada. No s'esborren mai soles: si la línia torna (perquè es desfà un
// canvi al diagrama o es torna a fer la connexió), la configuració hi torna
// amb ella. Eliminar-les és sempre una acció explícita d'aquesta llista.
function paintOrphanLines(activeSignatures) {
  const orphans = ProcessModel.orphanLines(activeSignatures);
  orphanLines.hidden = orphans.length === 0;
  orphanList.replaceChildren();

  orphans.forEach((signature) => {
    const config = ProcessModel.getLine(signature);
    const [pickupId, consumptionId] = signature.split('|');

    const item = document.createElement('li');
    item.className = 'orphan-item';

    const text = document.createElement('span');
    text.className = 'orphan-item__text';

    const name = document.createElement('span');
    name.className = 'orphan-item__name';
    name.textContent = `${config.name || 'Sense nom'} · ${config.throughput} kg/h`;

    const pair = document.createElement('span');
    pair.className = 'orphan-item__pair';
    pair.textContent = `${processElementName(pickupId)} → ${processElementName(consumptionId)}`;

    text.append(name, pair);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'orphan-item__remove';
    remove.textContent = 'Elimina';
    remove.title = 'Elimina aquesta configuració definitivament';
    remove.addEventListener('click', () => {
      ProcessModel.deleteLine(signature);
      paintLinesPanel();
      pushHistory();
    });

    item.append(text, remove);
    orphanList.appendChild(item);
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

// ---- Panell de configuració de procés ----
// Un únic panell per a les quatre fitxes (element d'emmagatzematge, punt de
// consum, punt de recollida i línia de transport). El formulari es
// construeix a partir de l'esquema que declara ProcessModel, de manera que
// afegir o treure un camp és tocar aquella llista i res més. Visualment és
// la mateixa targeta que el panell de línies de transport, a l'altre costat
// de la pantalla perquè els dos puguin conviure oberts.
const processPanel = document.getElementById('process-panel');
const processTitle = document.getElementById('process-panel-title');
const processSubject = document.getElementById('process-subject');
const processForm = document.getElementById('process-form');
const processSource = document.getElementById('process-source');
const processNote = document.getElementById('process-note');
const processCancel = document.getElementById('process-cancel');
const processClose = document.getElementById('process-close');

// Què s'està editant ara mateix: l'esquema, els valors de partida i què fer
// en desar. El panell no guarda cap referència a l'element o a la línia,
// només l'identificador que li calgui, de manera que no pot quedar-se
// apuntant a res que ja no existeixi.
let processEditor = null;

function setProcessNote(message, isError = false) {
  processNote.textContent = message;
  processNote.hidden = !message;
  processNote.classList.toggle('toolbar-note--error', Boolean(isError));
}

function closeProcessPanel() {
  processPanel.hidden = true;
  processEditor = null;
  processForm.replaceChildren();
  processSource.replaceChildren();
  processSource.hidden = true;
  setProcessNote('');
}

// Tanca el panell només si el que s'hi està editant és aquest element (es
// fa servir en eliminar-lo).
function closeProcessPanelFor(elementId) {
  if (processEditor && processEditor.elementId === elementId) closeProcessPanel();
}

// Nom per defecte d'un element: el seu tipus i el distintiu del rol
// ("Silo - S1", "Injector - P7"). Es fa servir en dos llocs, i per això és
// una funció i no un text escrit dues vegades: per ensenyar l'element allà
// on encara no té nom, i per omplir el camp Nom de la seva fitxa la primera
// vegada que s'obre.
function defaultElementName(element) {
  const role = element.dataset.transportRole;
  const badge = role ? ` - ${ROLE_PREFIX[role]}${element.dataset.transportRoleId}` : '';
  return `${typeLabel(element.dataset.type)}${badge}`;
}

// Nom amb què es presenta un element: el que li hagi posat l'usuari a la
// fitxa i, si encara no en té cap, el nom per defecte.
function elementDisplayName(element) {
  const role = element.dataset.transportRole;
  const stored = role ? ProcessModel.getElement(element.dataset.id, role) : null;
  return (stored && stored.name) ? stored.name : defaultElementName(element);
}

function processElementName(elementId) {
  const element = viewport.querySelector(`.pid-element[data-id="${elementId}"]`);
  return element ? elementDisplayName(element) : elementId;
}

// Topologia en format pla per al model de procés, que no sap llegir el
// canvas. És l'única passarel·la entre la capa de dibuix i la de dades.
function buildProcessGraph() {
  const graph = {};

  buildTopology().forEach((node, id) => {
    const ports = {};
    node.ports.forEach((link, port) => {
      ports[port] = { otherId: link.otherId, otherPort: link.otherPort };
    });

    graph[id] = {
      type: node.element.dataset.type,
      role: node.element.dataset.transportRole || '',
      ports,
    };
  });

  return graph;
}

// Camps del formulari a partir de l'esquema. La unitat va sempre enganxada
// a l'etiqueta perquè no es pugui llegir un número sense saber de què és.
// Els números van en camps de text i no en <input type="number"> perquè
// aquí s'escriu amb coma decimal; de validar-ho ja se n'ocupa ProcessModel.
function buildProcessFields(kind, values) {
  processForm.replaceChildren();

  ProcessModel.schemaFor(kind).forEach((field) => {
    const row = document.createElement('label');
    row.className = 'process-field';

    const caption = document.createElement('span');
    caption.className = 'process-field__label';
    caption.textContent = field.unit ? `${field.label} (${field.unit})` : field.label;

    const input = document.createElement('input');
    input.className = 'process-field__input';
    input.type = 'text';
    input.name = field.key;
    input.autocomplete = 'off';
    input.value = String(values[field.key]);
    if (field.type === 'number') input.inputMode = 'decimal';

    row.append(caption, input);
    processForm.appendChild(row);
  });
}

// Tot el que hi ha al formulari, inclosos els controls que viuen fora del
// <form> però hi estan associats amb l'atribut form (el selector d'origen
// del punt de recollida).
function readProcessForm() {
  const values = {};
  [...processForm.elements].forEach((control) => {
    if (control.name) values[control.name] = control.value;
  });
  return values;
}

function markInvalidFields(errors) {
  [...processForm.elements].forEach((control) => {
    if (control.name) {
      control.classList.toggle('process-field__input--invalid', Boolean(errors[control.name]));
    }
  });
}

function openProcessPanel(editor) {
  closeProcessPanel();
  processEditor = editor;

  processTitle.textContent = editor.title;
  processSubject.textContent = editor.subject;
  buildProcessFields(editor.kind, editor.values);
  if (editor.renderExtra) editor.renderExtra();

  processPanel.hidden = false;
  const first = processForm.querySelector('input');
  if (first) first.focus();
}

processForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!processEditor) return;

  const raw = readProcessForm();
  const result = ProcessModel.validate(processEditor.kind, raw);
  markInvalidFields(result.errors);

  if (!result.ok) {
    const field = ProcessModel.schemaFor(processEditor.kind).find((f) => result.errors[f.key]);
    setProcessNote(`${field.label}: ${result.errors[field.key]}`, true);
    return;
  }

  processEditor.onSave(result.values, raw);
  closeProcessPanel();
  // Configurar és una acció més de l'usuari: entra a l'historial i, per
  // tant, es pot desfer igual que moure o connectar.
  pushHistory();
});

processCancel.addEventListener('click', closeProcessPanel);
processClose.addEventListener('click', closeProcessPanel);

// ---- Origen del producte d'un punt de recollida ----
// Es torna a calcular en obrir la fitxa i en prémer "Tornar a detectar", mai
// de forma contínua. El selector viu aquí dins (i no entre els camps
// normals) perquè va acompanyat del resultat de la detecció, però està
// associat al formulari amb l'atribut form, de manera que es desa i es
// cancel·la amb la resta de la fitxa.
function refreshPickupSource(element) {
  const elementId = element.dataset.id;
  const current = processSource.querySelector('select[name="storageChoice"]');
  const override = current ? current.value : undefined;

  const source = ProcessModel.resolvePickupSource(
    buildProcessGraph(), elementId, canCrossElement, override,
  );

  processSource.replaceChildren();
  processSource.hidden = false;

  const title = document.createElement('h3');
  title.className = 'lines-panel__subtitle';
  title.textContent = 'Origen del producte';
  processSource.appendChild(title);

  const state = document.createElement('p');
  state.className = 'process-panel__state';

  if (source.status === 'none') {
    state.classList.add('process-panel__state--warn');
    state.textContent = 'Sense origen detectat: no hi ha cap element d\'emmagatzematge '
      + 'connectat amb aquest punt de recollida.';
  } else if (source.status === 'ambiguous') {
    state.classList.add('process-panel__state--warn');
    state.textContent = `Hi ha ${source.candidates.length} elements d'emmagatzematge a la `
      + 'mateixa distància. Tria quin alimenta aquest punt de recollida.';
  } else {
    const storage = ProcessModel.getElement(source.storageId, ROLE_STORAGE);
    state.textContent = [
      processElementName(source.storageId),
      `Producte: ${storage.product || 'sense definir'}`,
      `Quantitat: ${ProcessModel.formatKg(storage.quantity)} kg`,
    ].join(' · ');
  }

  processSource.appendChild(state);

  if (source.status === 'chosen') {
    const chosen = document.createElement('p');
    chosen.className = 'process-panel__route';
    chosen.textContent = source.stale
      ? 'Elecció manual. Ara mateix aquest element no surt entre els detectats automàticament.'
      : 'Elecció manual.';
    processSource.appendChild(chosen);
  }

  if (source.path && source.path.length > 1) {
    const route = document.createElement('p');
    route.className = 'process-panel__route';
    route.textContent = source.path.map(processElementName).join(' › ');
    processSource.appendChild(route);
  }

  // El selector només té sentit si hi ha alguna cosa a triar: candidats
  // detectats o una elecció manual que es pugui desfer.
  const options = source.candidates.map((candidate) => candidate.id);
  if (source.storageId && !options.includes(source.storageId)) options.push(source.storageId);

  if (options.length) {
    const row = document.createElement('label');
    row.className = 'process-field';

    const caption = document.createElement('span');
    caption.className = 'process-field__label';
    caption.textContent = 'Element d\'emmagatzematge';

    const select = document.createElement('select');
    select.className = 'process-field__input';
    select.name = 'storageChoice';
    // Viu fora del <form>, però n'és part a tots els efectes.
    select.setAttribute('form', 'process-form');

    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Detecció automàtica';
    select.appendChild(auto);

    options.forEach((storageId) => {
      const option = document.createElement('option');
      option.value = storageId;
      option.textContent = processElementName(storageId);
      select.appendChild(option);
    });

    select.value = override === undefined ? ProcessModel.getPickupChoice(elementId) : override;
    select.addEventListener('change', () => refreshPickupSource(element));

    row.append(caption, select);
    processSource.appendChild(row);
  }

  const redetect = document.createElement('button');
  redetect.type = 'button';
  redetect.className = 'lines-panel__recalc';
  redetect.textContent = 'Tornar a detectar';
  redetect.addEventListener('click', () => refreshPickupSource(element));
  processSource.appendChild(redetect);
}

// ---- Obertura de cada fitxa ----
function openElementProcessPanel(element) {
  const role = element.dataset.transportRole;
  if (!role) return;

  const elementId = element.dataset.id;
  const values = ProcessModel.getElement(elementId, role);

  // El camp Nom surt ja omplert la primera vegada, de manera que un element
  // configurat sempre acaba tenint un nom llegible sense haver-lo d'escriure.
  // Un nom que l'usuari ja hi hagi posat no es toca mai.
  if (!values.name) values.name = defaultElementName(element);

  const editor = {
    kind: role,
    elementId,
    title: ROLE_LABELS[role],
    subject: `${typeLabel(element.dataset.type)} · ${ROLE_PREFIX[role]}${element.dataset.transportRoleId}`,
    values,
    onSave: (values, raw) => {
      ProcessModel.setElement(elementId, role, values);
      // L'elecció d'origen no és un camp de l'esquema sinó una decisió que
      // mana sobre un càlcul, però es desa amb la resta de la fitxa.
      if (role === ROLE_PICKUP) ProcessModel.setPickupChoice(elementId, raw.storageChoice || '');
      if (!linesPanel.hidden) paintLinesPanel();
    },
  };

  if (role === ROLE_PICKUP) editor.renderExtra = () => refreshPickupSource(element);

  openProcessPanel(editor);
}

function openLineProcessPanel(line) {
  const signature = ProcessModel.lineSignature(line);
  const pair = `${ROLE_LABELS[ROLE_PICKUP]} ${line.pickupNumber} `
    + `→ ${ROLE_LABELS[ROLE_CONSUMPTION]} ${line.consumptionNumber}`;

  openProcessPanel({
    kind: 'line',
    title: 'Línia de transport',
    subject: `Línia ${line.number} · ${pair}`,
    values: ProcessModel.getLine(signature),
    onSave: (values) => {
      ProcessModel.setLine(signature, values);
      paintLinesPanel();
    },
  });
}

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

  // El model de procés forma part de l'estat a tots els efectes: així
  // desfer/refer i els arxius .pid.json el porten sense cap codi a part.
  return { elements, pipes: pipesData, elementCount, process: ProcessModel.serialize() };
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
  // Un arxiu d'abans d'aquesta etapa no porta model de procés: load() el
  // deixa buit, que és exactament el que toca.
  ProcessModel.load(state.process);
  closeProcessPanel();

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

  // Desfer, refer i obrir un arxiu poden haver canviat el diagrama sencer i
  // la seqüència: la simulació s'ha de refer amb el que hi ha ara.
  refreshSimulationIfOpen();
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
  // Qualsevol acció de l'usuari pot haver canviat el diagrama, la
  // configuració d'una línia o la seqüència. Si el panell de simulació és
  // obert, es torna a compilar (vegeu refreshSimulation).
  refreshSimulationIfOpen();
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

// ---- Interfície de simulació ----
// Dona pantalla al motor de càlcul (simulation.js). AQUÍ NO S'HI CALCULA
// RES: el bucle de reproducció només fa avançar un rellotge i, a cada pas,
// li demana l'estat al motor. Si algun dia us trobeu multiplicant quilos en
// aquest fitxer, heu agafat el camí equivocat.
//
// Peces: el pont que construeix l'escenari a partir del diagrama, el bucle
// de reproducció, l'editor de seqüència, el cronograma amb el cursor, i les
// dues llistes de només lectura (acció actual i estat del sistema).
// Vegeu docs/SIMULATION.md.

const simPanel = document.getElementById('sim-panel');
const simToggle = document.getElementById('time-calc');
const simCloseButton = document.getElementById('sim-close');
const simPlayButton = document.getElementById('sim-play');
const simPauseButton = document.getElementById('sim-pause');
const simStopButton = document.getElementById('sim-stop');
const simSpeedSelect = document.getElementById('sim-speed');
const simClock = document.getElementById('sim-clock');
const simIssues = document.getElementById('sim-issues');
const simTicks = document.getElementById('sim-ticks');
const simTrack = document.getElementById('sim-track');
const simBlocksHost = document.getElementById('sim-blocks');
const simCursor = document.getElementById('sim-cursor');
const simRows = document.getElementById('sim-rows');
const simEmpty = document.getElementById('sim-empty');
const simTotal = document.getElementById('sim-total');
const simAddButton = document.getElementById('sim-add');
const simFactsList = document.getElementById('sim-now');
const simStateHost = document.getElementById('sim-state');

// Referència de velocitat: 1 segon real = 1 minut de simulació a 1x. La
// velocitat NOMÉS multiplica això; els números d'un instant donat no en
// depenen mai.
const SIM_SECONDS_PER_REAL_SECOND = 60;
const SIM_STEP = 5;   // salt de les fletxes del teclat, en segons

// L'escenari i la compilació vigents. Es refan quan canvia alguna cosa que
// hi influeix (vegeu refreshSimulation), mai a cada imatge ni a cada
// moviment del cursor: moure el cursor només consulta el que ja hi ha.
let simScenario = null;
let simCompiled = null;

let simTime = 0;
let simPlaying = false;
let simFrameId = 0;
let simLastFrame = 0;
let simScrubbing = false;
let simResumeAfterScrub = false;

// Nodes de text que s'actualitzen a cada imatge. Es guarden en construir
// les llistes i després només se'ls canvia el contingut: així el bucle no
// reconstrueix DOM seixanta cops per segon ni fa saltar cap barra de
// desplaçament.
let simFactNodes = {};
let simValueNodes = { storages: {}, consumptions: {} };

// Recorregut de cada línia detectada, per a la capa visual (vegeu
// buildSimulationScenario).
let simLineRoutes = {};

// ---- Format ----
function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function actionLabel(type) {
  return ProcessModel.ACTION_LABELS[type] || type;
}

function simLineName(lineId) {
  const line = simScenario && simScenario.lines[lineId];
  return line ? line.name : lineId;
}

// ---- El pont entre el diagrama i el motor ----
// Converteix el que hi ha al canvas i al model de procés en l'escenari pla
// que espera SimulationEngine. És l'ÚNIC lloc que sap com es diu cada cosa
// a les dues bandes; el motor no sap res del diagrama i el diagrama no sap
// res del motor.
function buildSimulationScenario() {
  const scenario = {
    storages: {},
    consumptions: {},
    lines: {},
    actions: ProcessModel.getSequence(),
  };

  elementsWithRole(ROLE_STORAGE).forEach((element) => {
    const id = element.dataset.id;
    scenario.storages[id] = {
      ...ProcessModel.getElement(id, ROLE_STORAGE),
      name: elementDisplayName(element),
    };
  });

  elementsWithRole(ROLE_CONSUMPTION).forEach((element) => {
    const id = element.dataset.id;
    scenario.consumptions[id] = {
      ...ProcessModel.getElement(id, ROLE_CONSUMPTION),
      name: elementDisplayName(element),
    };
  });

  const graph = buildProcessGraph();
  simLineRoutes = {};

  findTransportLines().lines.forEach((line) => {
    const signature = ProcessModel.lineSignature(line);
    // El recorregut (elements i canonades, en ordre) no entra a l'escenari
    // perquè el motor no en fa res, però el necessita la capa visual per
    // saber quines canonades ha de destacar i per on han d'anar les
    // partícules del flux.
    simLineRoutes[signature] = line;
    const config = ProcessModel.getLine(signature);
    const source = ProcessModel.resolvePickupSource(graph, line.pickupPointId, canCrossElement);

    scenario.lines[signature] = {
      // Sense nom propi, el parell de rols identifica la línia i no canvia
      // a cada recàlcul, cosa que el número de línia sí que faria.
      name: config.name
        || `${ROLE_PREFIX[ROLE_PICKUP]}${line.pickupNumber} → ${ROLE_PREFIX[ROLE_CONSUMPTION]}${line.consumptionNumber}`,
      throughput: config.throughput,
      diameter: config.diameter,
      length: config.length,
      configured: ProcessModel.hasLine(signature),
      pickupId: line.pickupPointId,
      pickupName: processElementName(line.pickupPointId),
      consumptionId: line.consumptionPointId,
      storageId: source.storageId,
      storageStatus: source.status,
    };
  });

  return scenario;
}

// Per què una línia no es pot fer servir. Es pregunta AL MOTOR, validant
// una seqüència d'una sola acció de transport amb aquesta línia: així el
// motiu és exactament el mateix que veuria l'usuari en prémer Play i aquest
// fitxer no ha de repetir cap regla.
function simLineProblems(lineId) {
  if (!simScenario || !lineId || !simScenario.lines[lineId]) return [];
  const probe = { ...simScenario, actions: [{ order: 1, type: 'transport', lineId, duration: 60 }] };
  return SimulationEngine.validate(probe).errors.filter((issue) => issue.lineId === lineId);
}

// ---- Compilació ----
// Es refà en obrir el panell, en prémer Play i cada cop que canvia alguna
// cosa que hi influeix (la seqüència, el diagrama o la configuració de les
// línies, que passen totes per l'historial).
function refreshSimulation() {
  simScenario = buildSimulationScenario();
  simCompiled = SimulationEngine.compile(simScenario);

  if (!simCompiled.ok) pauseSimulation();
  simTime = Math.min(simTime, simCompiled.totalDuration);

  renderSimIssues();
  renderSimSequence();
  renderSimTimeline();
  buildSimStateShell();
  buildSimBars();
  renderSimNow();
  updateSimControls();
}

function refreshSimulationIfOpen() {
  if (simPanel && !simPanel.hidden) refreshSimulation();
}

// ---- Reproducció ----
// El bucle fa servir el temps real transcorregut entre imatges, no un
// comptatge d'imatges: així el resultat no depèn de la potència de
// l'ordinador ni de si el navegador va just.
function setSimTime(seconds) {
  simTime = Math.min(Math.max(Number(seconds) || 0, 0), simCompiled ? simCompiled.totalDuration : 0);
  renderSimNow();
  // Els botons han de reflectir sempre on som: arrossegar el cursor fora
  // del zero ha de tornar a activar Stop, per exemple.
  updateSimControls();
}

function simTick(now) {
  if (!simPlaying) return;

  const realSeconds = (now - simLastFrame) / 1000;
  simLastFrame = now;
  // Les partícules del flux avancen amb el temps REAL, no amb el de
  // simulació: si anessin amb el segon, a 10x es convertirien en una
  // ratlla borrosa i a 0,25x semblarien aturades.
  simFlowPhase += realSeconds * SIM_FLOW_SPEED;
  setSimTime(simTime + realSeconds * SIM_SECONDS_PER_REAL_SECOND * Number(simSpeedSelect.value));

  if (simTime >= simCompiled.totalDuration) {
    pauseSimulation();
    return;
  }
  simFrameId = requestAnimationFrame(simTick);
}

function startPlaybackLoop() {
  if (!simCompiled || !simCompiled.ok || !simCompiled.totalDuration) return;
  simPlaying = true;
  simLastFrame = performance.now();
  simFrameId = requestAnimationFrame(simTick);
  updateSimControls();
}

function playSimulation() {
  // Es compila en prémer Play: el que es reprodueix és sempre el diagrama
  // i la seqüència d'ara, no els d'abans.
  refreshSimulation();
  if (!simCompiled.ok) return;   // els errors bloquegen la reproducció

  if (simTime >= simCompiled.totalDuration) setSimTime(0);
  startPlaybackLoop();
}

function pauseSimulation() {
  simPlaying = false;
  cancelAnimationFrame(simFrameId);
  updateSimControls();
}

// Torna a la situació inicial. No toca res del projecte: només posa el
// rellotge a zero i torna a demanar l'estat al motor.
function stopSimulation() {
  pauseSimulation();
  setSimTime(0);
  updateSimControls();
}

function updateSimControls() {
  const ready = Boolean(simCompiled && simCompiled.ok && simCompiled.totalDuration);
  simPlayButton.disabled = !ready || simPlaying;
  simPauseButton.disabled = !simPlaying;
  simStopButton.disabled = !ready || (!simPlaying && simTime === 0);
}

// ---- Errors i avisos ----
function renderSimIssues() {
  const errors = simCompiled ? simCompiled.errors : [];
  const warnings = simCompiled ? simCompiled.warnings : [];

  simIssues.replaceChildren();
  simIssues.classList.toggle('sim-issues--error', errors.length > 0);
  simIssues.classList.toggle('sim-issues--warn', errors.length === 0 && warnings.length > 0);
  simIssues.hidden = !errors.length && !warnings.length;
  if (simIssues.hidden) return;

  const list = errors.length ? errors : warnings;
  const heading = document.createElement('p');
  heading.className = 'sim-issues__heading';
  heading.textContent = errors.length
    ? (errors.length === 1 ? 'No es pot simular:' : `No es pot simular (${errors.length} problemes):`)
    : (warnings.length === 1 ? 'Avís:' : `Avisos (${warnings.length}):`);
  simIssues.appendChild(heading);

  list.forEach((issue) => {
    const line = document.createElement('p');
    line.textContent = issue.message;
    simIssues.appendChild(line);
  });
}

// ---- Editor de seqüència ----
function commitSequence(actions) {
  ProcessModel.setSequence(actions);
  // Entra a l'historial com qualsevol altra acció de l'usuari; pushHistory
  // torna a compilar la simulació si el panell és obert.
  pushHistory();
}

function simSelect(value, options, onChange) {
  const select = document.createElement('select');
  select.className = 'process-field__input';

  options.forEach((option) => {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    if (option.disabled) node.disabled = true;
    if (option.title) node.title = option.title;
    select.appendChild(node);
  });

  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function simIconButton(iconId, label, disabled, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sim-icon-btn';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${iconId}" /></svg>`;
  button.addEventListener('click', onClick);
  return button;
}

function renderSimSequence() {
  const actions = ProcessModel.getSequence();
  const transport = ProcessModel.ACTION_TYPES.TRANSPORT;

  simRows.replaceChildren();
  simEmpty.hidden = actions.length > 0;
  simTotal.textContent = `Total ${formatClock(actions.reduce((sum, a) => sum + a.duration, 0))}`;

  const typeOptions = Object.values(ProcessModel.ACTION_TYPES)
    .map((type) => ({ value: type, label: actionLabel(type) }));

  actions.forEach((action, index) => {
    const row = document.createElement('tr');

    const order = document.createElement('td');
    order.className = 'sim-row__order';
    order.textContent = String(action.order);

    const type = document.createElement('td');
    type.appendChild(simSelect(action.type, typeOptions, (value) => {
      const next = ProcessModel.getSequence();
      next[index].type = value;
      commitSequence(next);
    }));

    // Línia: només per a les accions que mouen producte. Les línies que no
    // es poden fer servir surten desactivades, amb el motiu al tooltip i,
    // si són la que hi ha triada, també escrit a la columna del costat.
    const lineCell = document.createElement('td');
    if (action.type === transport) {
      const options = [{ value: '', label: '— Tria una línia —' }];
      Object.keys(simScenario ? simScenario.lines : {}).forEach((id) => {
        const problems = simLineProblems(id);
        options.push({
          value: id,
          label: problems.length ? `${simLineName(id)} (no disponible)` : simLineName(id),
          // La que ja està triada no es desactiva mai: si no, no es podria
          // ni veure ni canviar.
          disabled: problems.length > 0 && id !== action.lineId,
          title: problems.length ? problems[0].message : '',
        });
      });
      lineCell.appendChild(simSelect(action.lineId, options, (value) => {
        const next = ProcessModel.getSequence();
        next[index].lineId = value;
        commitSequence(next);
      }));
    } else {
      lineCell.textContent = '—';
      lineCell.className = 'sim-row__unit';
    }

    // Durada: s'escriu en minuts i es desa en segons.
    const durationCell = document.createElement('td');
    const duration = document.createElement('div');
    duration.className = 'sim-row__duration';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'process-field__input';
    input.value = String(action.duration / 60);
    input.addEventListener('change', () => {
      const minutes = ProcessModel.parseNumber(input.value);
      const next = ProcessModel.getSequence();
      next[index].duration = minutes === null ? 0 : minutes * 60;
      commitSequence(next);
    });
    const unit = document.createElement('span');
    unit.className = 'sim-row__unit';
    unit.textContent = 'min';
    duration.append(input, unit);
    durationCell.appendChild(duration);

    // Estimació: el que diu el motor per a aquesta acció, no un càlcul fet
    // aquí. Si la línia té algun problema, hi va el motiu.
    const estimate = document.createElement('td');
    estimate.className = 'sim-row__estimate';
    if (action.type !== transport) {
      estimate.textContent = '—';
    } else {
      const problems = simLineProblems(action.lineId);
      if (!action.lineId) {
        estimate.classList.add('sim-row__estimate--short');
        estimate.textContent = 'Cap línia triada';
      } else if (problems.length) {
        estimate.classList.add('sim-row__estimate--short');
        estimate.textContent = problems[0].message;
        estimate.title = problems[0].message;
      } else {
        const line = simScenario.lines[action.lineId];
        const storage = simScenario.storages[line.storageId];
        const result = simCompiled.ok ? simCompiled.actions[index] : null;
        const parts = [storage && storage.product ? storage.product : 'sense producte', `${line.throughput} kg/h`];
        if (result) {
          parts.push(`${ProcessModel.formatKg(result.transferred)} kg`);
          if (!result.complete) estimate.classList.add('sim-row__estimate--short');
        }
        estimate.textContent = parts.join(' · ');
        if (result && !result.complete) {
          estimate.title = 'El magatzem es buida abans que s\'acabi aquesta acció.';
        }
      }
    }

    const buttons = document.createElement('td');
    buttons.className = 'sim-row__actions';
    buttons.append(
      simIconButton('i-up', 'Puja', index === 0, () => {
        const next = ProcessModel.getSequence();
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        commitSequence(next);
      }),
      simIconButton('i-down', 'Baixa', index === actions.length - 1, () => {
        const next = ProcessModel.getSequence();
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        commitSequence(next);
      }),
      simIconButton('i-trash', 'Elimina', false, () => {
        const next = ProcessModel.getSequence();
        next.splice(index, 1);
        commitSequence(next);
      }),
    );
    buttons.querySelector('.sim-icon-btn:last-child').classList.add('sim-icon-btn--danger');

    row.append(order, type, lineCell, durationCell, estimate, buttons);
    simRows.appendChild(row);
  });
}

// ---- Cronograma ----
function renderSimTimeline() {
  simBlocksHost.replaceChildren();
  simTicks.replaceChildren();

  const total = simCompiled && simCompiled.ok ? simCompiled.totalDuration : 0;
  simTrack.setAttribute('aria-valuemax', String(Math.round(total)));
  if (!total) {
    simCursor.style.left = '0%';
    return;
  }

  simCompiled.actions.forEach((action) => {
    const block = document.createElement('div');
    block.className = 'sim-block';
    if (!action.moving) block.classList.add('sim-block--idle');
    else if (!action.complete) block.classList.add('sim-block--short');
    block.style.left = `${(action.startTime / total) * 100}%`;
    block.style.width = `${(action.duration / total) * 100}%`;

    const name = document.createElement('span');
    name.className = 'sim-block__name';
    name.textContent = actionLabel(action.type);

    const line = document.createElement('span');
    line.className = 'sim-block__line';
    line.textContent = action.lineId ? simLineName(action.lineId) : '—';

    block.append(name, line);
    simBlocksHost.appendChild(block);
  });

  // Marques de temps a les fronteres de les accions, saltant-se les que
  // caurien massa a prop de l'anterior perquè no s'encavalquin.
  let last = -Infinity;
  [0, ...simCompiled.actions.map((action) => action.endTime)].forEach((seconds) => {
    const ratio = seconds / total;
    if (ratio - last < 0.07 && seconds !== total) return;
    last = ratio;

    const tick = document.createElement('span');
    tick.className = 'sim-timeline__tick';
    tick.style.left = `${ratio * 100}%`;
    tick.textContent = `${Math.round(seconds / 60)} min`;
    simTicks.appendChild(tick);
  });
}

// ---- Acció actual i estat del sistema ----
// L'estructura es construeix un sol cop (aquí) i el bucle només canvia els
// textos, de manera que reproduir no reconstrueix DOM contínuament.
const SIM_FACTS = [
  ['action', 'Acció'],
  ['line', 'Línia'],
  ['time', 'Temps'],
  ['status', 'Estat'],
  ['product', 'Producte'],
  ['throughput', 'Rendiment'],
  ['moved', 'Transferits'],
];

function buildSimFactsShell() {
  simFactsList.replaceChildren();
  simFactNodes = {};

  SIM_FACTS.forEach(([key, label]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    value.textContent = '—';
    simFactNodes[key] = value;
    simFactsList.append(term, value);
  });
}

function buildSimStateShell() {
  simStateHost.replaceChildren();
  simValueNodes = { storages: {}, consumptions: {} };

  const groups = [
    ['storages', 'Elements d\'emmagatzematge'],
    ['consumptions', 'Punts de consum'],
  ];

  groups.forEach(([bucket, label]) => {
    const entries = Object.keys(simScenario ? simScenario[bucket] : {}).sort();
    const heading = document.createElement('p');
    heading.className = 'sim-state__group';
    heading.textContent = label;
    simStateHost.appendChild(heading);

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'sim-hint';
      empty.textContent = 'Cap de definit al diagrama.';
      simStateHost.appendChild(empty);
      return;
    }

    entries.forEach((id) => {
      const row = document.createElement('div');
      row.className = 'sim-state__row';

      const name = document.createElement('span');
      name.className = 'sim-state__name';
      name.textContent = simScenario[bucket][id].name || id;

      const value = document.createElement('span');
      value.className = 'sim-state__value';
      value.textContent = '—';

      simValueNodes[bucket][id] = value;
      row.append(name, value);
      simStateHost.appendChild(row);
    });
  });
}

// L'única funció que es crida a cada imatge. Demana l'estat al motor i
// escriu els textos; no calcula res.
function renderSimNow() {
  const total = simCompiled ? simCompiled.totalDuration : 0;
  simClock.textContent = `${formatClock(simTime)} / ${formatClock(total)}`;
  simCursor.style.left = total ? `${(simTime / total) * 100}%` : '0%';
  simTrack.setAttribute('aria-valuenow', String(Math.round(simTime)));
  simTrack.setAttribute('aria-valuetext', `${formatClock(simTime)} de ${formatClock(total)}`);

  if (!simCompiled || !simCompiled.ok) {
    Object.values(simFactNodes).forEach((node) => { node.textContent = '—'; });
    Object.values(simValueNodes).forEach((bucket) => {
      Object.values(bucket).forEach((node) => { node.textContent = '—'; });
    });
    clearSimVisuals();
    renderSimSummary(null);
    return;
  }

  const state = SimulationEngine.stateAt(simCompiled, simTime);
  const action = state.action;
  const line = action && action.lineId ? simScenario.lines[action.lineId] : null;
  const storage = line ? simScenario.storages[line.storageId] : null;

  simFactNodes.action.textContent = action ? `${action.order}. ${actionLabel(action.type)}` : '—';
  simFactNodes.line.textContent = line ? line.name : '—';
  simFactNodes.time.textContent = action
    ? `${formatClock(simTime - action.startTime)} / ${formatClock(action.duration)}`
    : '—';

  let status = 'Aturada';
  if (state.finished) status = 'Acabada';
  else if (simPlaying) status = 'En marxa';
  else if (simTime > 0) status = 'En pausa';
  if (action && !action.complete) status += ' · incompleta';
  simFactNodes.status.textContent = status;
  simFactNodes.status.classList.toggle('is-short', Boolean(action && !action.complete));

  simFactNodes.product.textContent = storage && storage.product ? storage.product : '—';
  simFactNodes.throughput.textContent = line ? `${line.throughput} kg/h` : '—';
  simFactNodes.moved.textContent = action && action.lineId
    ? `${ProcessModel.formatKg(state.lines[action.lineId])} kg`
    : '—';

  Object.keys(simValueNodes.storages).forEach((id) => {
    simValueNodes.storages[id].textContent = `${ProcessModel.formatKg(state.storages[id])} kg`;
  });

  Object.keys(simValueNodes.consumptions).forEach((id) => {
    const node = simValueNodes.consumptions[id];
    const capacity = Number(simScenario.consumptions[id].capacity) || 0;
    node.textContent = `${ProcessModel.formatKg(state.consumptions[id])} kg`;
    node.classList.toggle('is-over', capacity > 0 && state.consumptions[id] > capacity);
  });

  // Fila de la seqüència que s'està reproduint.
  [...simRows.children].forEach((row, index) => {
    row.classList.toggle('is-current', Boolean(action) && index === action.order - 1);
  });

  renderSimVisuals(state);
  renderSimSummary(state);
}

// ---- Cursor arrossegable ----
// Arrossegar només consulta la compilació que ja hi ha: no en refà cap.
function simTimeFromPointer(clientX) {
  const rect = simTrack.getBoundingClientRect();
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  return ratio * (simCompiled ? simCompiled.totalDuration : 0);
}

simTrack.addEventListener('pointerdown', (event) => {
  if (!simCompiled || !simCompiled.ok || !simCompiled.totalDuration) return;
  event.preventDefault();
  simTrack.setPointerCapture(event.pointerId);
  simScrubbing = true;
  // Mentre s'arrossega, el rellotge no avança: així el bucle i el dit no
  // es barallen. Si estava reproduint, continua en deixar-lo anar.
  simResumeAfterScrub = simPlaying;
  if (simPlaying) pauseSimulation();
  setSimTime(simTimeFromPointer(event.clientX));
});

simTrack.addEventListener('pointermove', (event) => {
  if (simScrubbing) setSimTime(simTimeFromPointer(event.clientX));
});

['pointerup', 'pointercancel'].forEach((type) => {
  simTrack.addEventListener(type, (event) => {
    if (!simScrubbing) return;
    simScrubbing = false;
    if (simTrack.hasPointerCapture(event.pointerId)) simTrack.releasePointerCapture(event.pointerId);
    if (simResumeAfterScrub && simTime < simCompiled.totalDuration) startPlaybackLoop();
    simResumeAfterScrub = false;
    updateSimControls();
  });
});

// Avançar i retrocedir amb el teclat, per a qui no fa servir el ratolí.
simTrack.addEventListener('keydown', (event) => {
  if (!simCompiled || !simCompiled.ok) return;
  const jumps = {
    ArrowLeft: -SIM_STEP,
    ArrowRight: SIM_STEP,
    PageDown: -SIM_STEP * 12,
    PageUp: SIM_STEP * 12,
  };

  if (event.key === 'Home') setSimTime(0);
  else if (event.key === 'End') setSimTime(simCompiled.totalDuration);
  else if (jumps[event.key] !== undefined) setSimTime(simTime + jumps[event.key]);
  else return;

  event.preventDefault();
  updateSimControls();
});

// ---- Obrir i tancar ----
function openSimPanel() {
  simPanel.hidden = false;
  simToggle.setAttribute('aria-expanded', 'true');
  refreshSimulation();
  renderSimNow();
}

function closeSimPanel() {
  pauseSimulation();
  simPanel.hidden = true;
  simToggle.setAttribute('aria-expanded', 'false');
  // L'aspecte del diagrama torna exactament al d'abans.
  clearSimVisuals();
  hideSimTip();
}

simToggle.addEventListener('click', () => {
  if (simPanel.hidden) openSimPanel();
  else closeSimPanel();
});

// Amb la pestanya amagada el navegador deixa de donar imatges. Si no es
// posés en pausa, en tornar-hi el primer salt de temps seria enorme.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && simPlaying) pauseSimulation();
});

simCloseButton.addEventListener('click', closeSimPanel);
simPlayButton.addEventListener('click', playSimulation);
simPauseButton.addEventListener('click', pauseSimulation);
simStopButton.addEventListener('click', stopSimulation);

// Canviar de velocitat no altera el resultat: només la rapidesa amb què
// avança el rellotge. El temps actual no es toca.
simSpeedSelect.addEventListener('change', () => {
  simLastFrame = performance.now();
});

simAddButton.addEventListener('click', () => {
  const lines = Object.keys(simScenario ? simScenario.lines : {});
  const usable = lines.find((id) => !simLineProblems(id).length) || lines[0] || '';
  const actions = ProcessModel.getSequence();
  actions.push({ type: ProcessModel.ACTION_TYPES.TRANSPORT, lineId: usable, duration: 300 });
  commitSequence(actions);
});

buildSimFactsShell();

// ---- Capa visual de la simulació ----
// Dibuixa sobre el diagrama el que el motor diu que hi ha: el nivell de
// cada element, quina línia treballa i el producte viatjant-hi. Com la
// resta de la interfície de simulació, AQUÍ NO S'HI CALCULA RES: tot surt
// de l'estat que retorna SimulationEngine.stateAt().
//
// Tot el que dibuixa és temporal i viu a #sim-overlay, una capa a part amb
// pointer-events: none. Tancar el panell la buida i el diagrama torna
// exactament a l'aspecte d'abans.

const simTip = document.getElementById('sim-tip');
const simSummaryHost = document.getElementById('sim-summary');

// Velocitat de les partícules, en unitats de món per segon real. És un
// valor de lectura, no físic: no vol dir res sobre la velocitat real del
// producte, només serveix perquè es vegi cap on va.
const SIM_FLOW_SPEED = 150;
const SIM_FLOW_SPACING = 46;     // separació entre partícules
const SIM_MAX_PARTICLES = 28;    // sostre, per no carregar diagrames grans

let simFlowPhase = 0;
let simBarNodes = new Map();     // id d'element -> nodes de la seva barra
let simFlowNodes = [];
let simFlowChain = null;
let simFlowLineId = '';

const simReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---- Geometria ----
// Caixa del DIBUIX d'un element en coordenades de món. Es descarten els
// punts de connexió i el distintiu de rol, que sobresurten de la forma i
// farien que la barra no s'hi ajustés.
function elementDrawingBox(element) {
  const matrix = getLocalMatrix(element);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  [...element.children].forEach((child) => {
    if (child.tagName === 'title') return;
    if (child.classList && (child.classList.contains('connection-point')
      || child.classList.contains('role-badge'))) return;
    if (typeof child.getBBox !== 'function') return;

    const box = child.getBBox();
    if (!box.width && !box.height) return;

    // El dibuix pot anar dins d'un <g> amb la seva pròpia reducció de mida
    // (vegeu applyShapeScale), que getBBox() no inclou.
    let full = matrix;
    const list = child.transform.baseVal;
    for (let i = 0; i < list.numberOfItems; i += 1) full = full.multiply(list.getItem(i).matrix);

    [[box.x, box.y], [box.x + box.width, box.y],
      [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].forEach(([x, y]) => {
      const point = canvas.createSVGPoint();
      point.x = x;
      point.y = y;
      const world = point.matrixTransform(full);
      minX = Math.min(minX, world.x);
      minY = Math.min(minY, world.y);
      maxX = Math.max(maxX, world.x);
      maxY = Math.max(maxY, world.y);
    });
  });

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---- Barres de nivell ----
// Quins elements en porten: NOMÉS els que participen de debò a la
// seqüència, és a dir els magatzems i els punts de consum de les línies
// que fa servir alguna acció de transport. La resta del diagrama es queda
// neta.
function simParticipants() {
  const storages = new Set();
  const consumptions = new Set();
  if (!simScenario) return { storages, consumptions };

  simScenario.actions.forEach((action) => {
    const line = simScenario.lines[action.lineId];
    if (!line) return;
    if (simScenario.storages[line.storageId]) storages.add(line.storageId);
    if (simScenario.consumptions[line.consumptionId]) consumptions.add(line.consumptionId);
  });

  return { storages, consumptions };
}

function simBarGroup(elementId, bucket) {
  const element = viewport.querySelector(`.pid-element[data-id="${elementId}"]`);
  const box = element ? elementDrawingBox(element) : null;
  if (!box) return null;

  const group = svgEl('g', { class: 'sim-bar' });
  const track = svgEl('rect', {
    class: 'sim-bar__track', x: box.x, y: box.y, width: box.width, height: box.height, rx: 2,
  });
  const fill = svgEl('rect', { class: 'sim-bar__fill', x: box.x, width: box.width, y: box.y, height: 0 });
  const level = svgEl('line', { class: 'sim-bar__level', x1: box.x, x2: box.x + box.width, y1: box.y, y2: box.y });

  const label = svgEl('g', { class: 'sim-bar__label' });
  const kg = svgEl('text', { class: 'sim-bar__kg', x: 0, y: 0 });
  const pct = svgEl('text', { class: 'sim-bar__pct', x: 0, y: 13 });
  label.append(kg, pct);

  group.append(track, fill, level, label);
  simOverlay.appendChild(group);

  return { group, box, fill, level, label, kg, pct, bucket };
}

// Les etiquetes van a mida fixa de pantalla: es contra-escalen amb el zoom
// perquè es puguin llegir tant si el diagrama és molt petit com molt gros.
function updateSimLabelScale() {
  if (!simBarNodes || !simBarNodes.size) return;
  simBarNodes.forEach((bar) => {
    const x = bar.box.x + bar.box.width / 2;
    const y = bar.box.y + bar.box.height + 14 / viewScale;
    bar.label.setAttribute('transform', `translate(${x}, ${y}) scale(${1 / viewScale})`);
  });
}

function buildSimBars() {
  simBarNodes.forEach((bar) => bar.group.remove());
  simBarNodes = new Map();
  if (!simScenario || !simCompiled || !simCompiled.ok) return;

  const { storages, consumptions } = simParticipants();
  storages.forEach((id) => {
    const bar = simBarGroup(id, 'storages');
    if (bar) simBarNodes.set(id, bar);
  });
  consumptions.forEach((id) => {
    const bar = simBarGroup(id, 'consumptions');
    if (bar) simBarNodes.set(id, bar);
  });

  updateSimLabelScale();
}

// Percentatge honest: si no hi ha capacitat definida no se n'inventa cap,
// i llavors només es veuen els quilos.
function simLevelRatio(value, capacity) {
  if (!(capacity > 0)) return null;
  return Math.min(Math.max(value / capacity, 0), 1);
}

function renderSimBars(state) {
  simBarNodes.forEach((bar, id) => {
    const value = state[bar.bucket][id];
    const entry = simScenario[bar.bucket][id];
    const capacity = Number(entry.capacity) || 0;
    const ratio = simLevelRatio(value, capacity);

    // Sense capacitat, la barra no es pot omplir de manera honesta: es
    // deixa buida i només parla el número.
    const height = ratio === null ? 0 : bar.box.height * ratio;
    const top = bar.box.y + bar.box.height - height;

    bar.fill.setAttribute('y', top);
    bar.fill.setAttribute('height', height);
    bar.level.setAttribute('y1', top);
    bar.level.setAttribute('y2', top);
    bar.level.style.display = ratio === null ? 'none' : '';

    bar.kg.textContent = `${ProcessModel.formatKg(value)} kg`;
    bar.pct.textContent = ratio === null ? 'sense capacitat' : `${Math.round(ratio * 100)} %`;

    bar.group.classList.toggle('sim-bar--empty', value <= 0);
    bar.group.classList.toggle('sim-bar--over', capacity > 0 && value > capacity);
  });
}

// ---- Línia activa ----
// Classes pròpies, a part de les del ressaltat del panell de línies: així
// les dues coses conviuen i aturar la simulació no esborra el ressaltat
// que l'usuari hagi fixat.
function clearSimActiveLine() {
  viewport.querySelectorAll('.pipe-path--active')
    .forEach((node) => node.classList.remove('pipe-path--active'));
  viewport.querySelectorAll('.pid-element--active')
    .forEach((node) => node.classList.remove('pid-element--active'));
}

function renderSimActiveLine(lineId) {
  clearSimActiveLine();
  const route = lineId ? simLineRoutes[lineId] : null;
  if (!route) return;

  const connectors = new Set(route.pathConnectorIds);
  pipes.forEach((pipe) => {
    if (connectors.has(pipeKey(pipe))) pipe.path.classList.add('pipe-path--active');
  });

  const elements = new Set(route.pathElementIds);
  viewport.querySelectorAll('.pid-element:not(.pipe)').forEach((node) => {
    if (elements.has(node.dataset.id)) node.classList.add('pid-element--active');
  });
}

// ---- Flux del producte ----
// Les canonades del recorregut, encadenades i orientades en el sentit
// recollida -> consum, que és el que dona sentit a l'animació.
function buildSimFlowChain(lineId) {
  const route = simLineRoutes[lineId];
  if (!route) return null;

  const byKey = new Map();
  pipes.forEach((pipe) => byKey.set(pipeKey(pipe), pipe));

  const segments = [];
  let total = 0;

  route.pathConnectorIds.forEach((key, index) => {
    const pipe = byKey.get(key);
    if (!pipe) return;

    const length = pipe.path.getTotalLength();
    if (!length) return;

    // Si la canonada es va dibuixar del consum cap a la recollida, es
    // recorre de final a principi.
    const forward = pipe.from.element.dataset.id === route.pathElementIds[index];
    segments.push({ path: pipe.path, length, forward, offset: total });
    total += length;
  });

  return total ? { segments, total } : null;
}

function simFlowPoint(chain, distance) {
  const along = ((distance % chain.total) + chain.total) % chain.total;
  const segment = chain.segments.find((item) => along < item.offset + item.length)
    || chain.segments[chain.segments.length - 1];
  const local = along - segment.offset;
  return segment.path.getPointAtLength(segment.forward ? local : segment.length - local);
}

function clearSimFlow() {
  simFlowNodes.forEach((node) => node.remove());
  simFlowNodes = [];
  simFlowChain = null;
  simFlowLineId = '';
}

function renderSimFlow(lineId) {
  // Sense línia activa, amb la preferència de reduir moviment o amb la
  // reproducció aturada no hi ha res a animar.
  if (!lineId || simReducedMotion.matches) {
    if (simFlowNodes.length) clearSimFlow();
    return;
  }

  if (lineId !== simFlowLineId) {
    clearSimFlow();
    simFlowChain = buildSimFlowChain(lineId);
    simFlowLineId = lineId;

    if (simFlowChain) {
      const count = Math.min(SIM_MAX_PARTICLES,
        Math.max(3, Math.round(simFlowChain.total / SIM_FLOW_SPACING)));
      for (let i = 0; i < count; i += 1) {
        const dot = svgEl('circle', { class: 'sim-flow__dot', r: 2.6, cx: 0, cy: 0 });
        simOverlay.appendChild(dot);
        simFlowNodes.push(dot);
      }
    }
  }

  if (!simFlowChain) return;

  const gap = simFlowChain.total / simFlowNodes.length;
  simFlowNodes.forEach((dot, index) => {
    const point = simFlowPoint(simFlowChain, simFlowPhase + index * gap);
    dot.setAttribute('cx', point.x);
    dot.setAttribute('cy', point.y);
  });
}

// ---- Punt d'entrada de la capa visual ----
function renderSimVisuals(state) {
  renderSimBars(state);
  renderSimActiveLine(state.activeLineId);
  renderSimFlow(state.activeLineId);
}

function clearSimVisuals() {
  simBarNodes.forEach((bar) => bar.group.remove());
  simBarNodes = new Map();
  clearSimFlow();
  clearSimActiveLine();
}

// ---- Resum ----
// Retorna una estructura plana pensada per poder-se convertir en un
// informe més endavant; de moment només es pinta.
function buildSimSummary(state) {
  const lines = Object.keys(state.lines)
    .filter((id) => state.lines[id] > 0)
    .map((id) => ({ id, name: simLineName(id), transferred: state.lines[id] }))
    .sort((a, b) => b.transferred - a.transferred);

  const totalTransported = lines.reduce((sum, line) => sum + line.transferred, 0);

  const storages = Object.keys(state.storages).sort().map((id) => ({
    id,
    name: simScenario.storages[id].name,
    remaining: state.storages[id],
    capacity: Number(simScenario.storages[id].capacity) || 0,
  }));

  const consumptions = Object.keys(state.consumptions).sort().map((id) => ({
    id,
    name: simScenario.consumptions[id].name,
    received: state.consumptions[id],
    capacity: Number(simScenario.consumptions[id].capacity) || 0,
  }));

  // Incidències: les que ja han passat en aquest instant, no les de tota
  // la seqüència. Surten totes del motor.
  const emptied = state.warnings.filter((issue) => issue.code === 'storage-will-empty');
  const overCapacity = state.warnings.filter((issue) => issue.code === 'capacity-exceeded');
  const incomplete = simCompiled.actions.filter((action) => (
    !action.complete && action.startTime < state.time
  ));

  return {
    totalDuration: simCompiled.totalDuration,
    elapsed: state.time,
    totalTransported,
    lines,
    storages,
    consumptions,
    incidents: { emptied, overCapacity, incomplete },
  };
}

function simSummaryRow(label, value, modifier) {
  const row = document.createElement('div');
  row.className = modifier ? `sim-summary__row sim-summary__row--${modifier}` : 'sim-summary__row';

  const name = document.createElement('span');
  name.className = 'sim-summary__label';
  name.textContent = label;

  const amount = document.createElement('span');
  amount.className = 'sim-summary__value';
  amount.textContent = value;

  row.append(name, amount);
  return row;
}

function simSummaryGroup(text) {
  const heading = document.createElement('p');
  heading.className = 'sim-summary__group';
  heading.textContent = text;
  return heading;
}

function renderSimSummary(state) {
  simSummaryHost.replaceChildren();
  if (!state || !simCompiled || !simCompiled.ok) {
    const empty = document.createElement('p');
    empty.className = 'sim-hint';
    empty.textContent = 'Encara no hi ha res a resumir.';
    simSummaryHost.appendChild(empty);
    return;
  }

  const summary = buildSimSummary(state);

  simSummaryHost.append(
    simSummaryRow('Temps', `${formatClock(summary.elapsed)} / ${formatClock(summary.totalDuration)}`),
    simSummaryRow('Producte transportat', `${ProcessModel.formatKg(summary.totalTransported)} kg`, 'total'),
  );

  simSummaryHost.appendChild(simSummaryGroup(
    summary.lines.length === 1 ? 'Línia utilitzada' : `Línies utilitzades (${summary.lines.length})`,
  ));
  if (!summary.lines.length) {
    simSummaryHost.appendChild(simSummaryRow('Cap encara', '—'));
  } else {
    summary.lines.forEach((line) => {
      simSummaryHost.appendChild(simSummaryRow(line.name, `${ProcessModel.formatKg(line.transferred)} kg`));
    });
  }

  simSummaryHost.appendChild(simSummaryGroup('Queda als magatzems'));
  summary.storages.forEach((item) => {
    simSummaryHost.appendChild(simSummaryRow(item.name, `${ProcessModel.formatKg(item.remaining)} kg`));
  });

  simSummaryHost.appendChild(simSummaryGroup('Arribat al consum'));
  summary.consumptions.forEach((item) => {
    simSummaryHost.appendChild(simSummaryRow(item.name, `${ProcessModel.formatKg(item.received)} kg`));
  });

  simSummaryHost.appendChild(simSummaryGroup('Incidències'));
  const incidents = [
    ...summary.incidents.emptied.map((issue) => issue.message),
    ...summary.incidents.overCapacity.map((issue) => issue.message),
    ...summary.incidents.incomplete.map((action) => (
      `Acció ${action.order} (${actionLabel(action.type)}) va quedar incompleta: `
      + `només s'han transportat ${ProcessModel.formatKg(action.transferred)} kg.`
    )),
  ];

  if (!incidents.length) {
    const clean = document.createElement('p');
    clean.className = 'sim-summary__clean';
    clean.textContent = 'Cap, de moment.';
    simSummaryHost.appendChild(clean);
  } else {
    incidents.forEach((message) => {
      const line = document.createElement('p');
      line.className = 'sim-summary__incident';
      line.textContent = message;
      simSummaryHost.appendChild(line);
    });
  }
}

// ---- Informació en passar el ratolí ----
// Només amb la simulació aturada o en pausa: mentre es reprodueix, els
// números ja canvien sols i una etiqueta que els persegueix fa nosa.
function simTipRow(label, value, warn) {
  const row = document.createElement('div');
  row.className = 'sim-tip__row';

  const name = document.createElement('span');
  name.className = 'sim-tip__label';
  name.textContent = label;

  const amount = document.createElement('span');
  amount.className = warn ? 'sim-tip__value is-warn' : 'sim-tip__value';
  amount.textContent = value;

  row.append(name, amount);
  return row;
}

function simElementTip(elementId, state) {
  const bucket = simScenario.storages[elementId] ? 'storages'
    : (simScenario.consumptions[elementId] ? 'consumptions' : '');
  if (!bucket) return null;

  const entry = simScenario[bucket][elementId];
  const value = state[bucket][elementId];
  const capacity = Number(entry.capacity) || 0;
  const ratio = simLevelRatio(value, capacity);

  const nodes = [];
  const title = document.createElement('p');
  title.className = 'sim-tip__title';
  title.textContent = entry.name;
  nodes.push(title);

  nodes.push(simTipRow('Producte', entry.product || 'sense definir'));
  nodes.push(simTipRow(bucket === 'storages' ? 'Quantitat' : 'Rebut',
    `${ProcessModel.formatKg(value)} kg`, value <= 0 && bucket === 'storages'));
  nodes.push(simTipRow('Capacitat', capacity > 0 ? `${ProcessModel.formatKg(capacity)} kg` : 'sense definir'));
  nodes.push(simTipRow('Nivell', ratio === null ? '—' : `${Math.round(ratio * 100)} %`,
    capacity > 0 && value > capacity));

  return nodes;
}

function simPipeTip(pipeElement, state) {
  const pipe = pipes.find((item) => item.group === pipeElement);
  if (!pipe) return null;

  const key = pipeKey(pipe);
  const lineId = Object.keys(simLineRoutes).find((id) => (
    simScenario.lines[id] && simLineRoutes[id].pathConnectorIds.includes(key)
  ));
  if (!lineId) return null;

  const line = simScenario.lines[lineId];
  const active = state.activeLineId === lineId;

  const nodes = [];
  const title = document.createElement('p');
  title.className = 'sim-tip__title';
  title.textContent = line.name;
  nodes.push(title);

  nodes.push(simTipRow('Rendiment', `${line.throughput} kg/h`));
  nodes.push(simTipRow('Estat', active ? 'Treballant' : 'Aturada'));

  // Temps acumulat: el que sumen les accions d'aquesta línia que ja han
  // passat, comptat fins a l'instant actual.
  const elapsed = simCompiled.actions
    .filter((action) => action.lineId === lineId && action.startTime < state.time)
    .reduce((sum, action) => sum + Math.min(state.time, action.endTime) - action.startTime, 0);

  nodes.push(simTipRow('Temps acumulat', formatClock(elapsed)));
  nodes.push(simTipRow('Producte transferit', `${ProcessModel.formatKg(state.lines[lineId])} kg`));
  return nodes;
}

function hideSimTip() {
  simTip.hidden = true;
}

function showSimTip(nodes, event) {
  simTip.replaceChildren(...nodes);
  simTip.hidden = false;

  // Es col·loca al costat del cursor i es replega si no hi cap.
  const box = simTip.getBoundingClientRect();
  const left = Math.min(event.clientX + 16, window.innerWidth - box.width - 8);
  const top = Math.min(event.clientY + 16, window.innerHeight - box.height - 8);
  simTip.style.left = `${Math.max(8, left)}px`;
  simTip.style.top = `${Math.max(8, top)}px`;
}

canvas.addEventListener('mousemove', (event) => {
  if (simPanel.hidden || simPlaying || !simCompiled || !simCompiled.ok) {
    hideSimTip();
    return;
  }

  const target = event.target.closest ? event.target.closest('.pid-element') : null;
  if (!target) {
    hideSimTip();
    return;
  }

  const state = SimulationEngine.stateAt(simCompiled, simTime);
  const nodes = target.classList.contains('pipe')
    ? simPipeTip(target, state)
    : simElementTip(target.dataset.id, state);

  if (!nodes) {
    hideSimTip();
    return;
  }
  showSimTip(nodes, event);
});

canvas.addEventListener('mouseleave', hideSimTip);

// Captura inicial (canvas buit), perquè hi hagi alguna cosa a la qual
// tornar amb "Desfer" just després de la primera acció.
pushHistory();
