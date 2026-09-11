// ---- Model de dades de procés ----
// Capa de dades separada del dibuix: aquest fitxer no toca el DOM, no sap
// què és un SVG i no dibuixa res. Guarda el que hi ha DINS de la
// instal·lació (producte, quantitats, capacitats) i com són les línies de
// transport (rendiment, diàmetre, longitud), i ofereix els dos càlculs que
// en depenen: la signatura estable d'una línia i la cerca de l'element
// d'emmagatzematge que alimenta un punt de recollida.
//
// Tot el que hi entra i en surt són dades planes (objectes, cadenes i
// números), de manera que es pot serialitzar tal qual dins de l'arxiu del
// model i que una etapa posterior hi pugui construir a sobre sense
// dependre'n de la interfície. Vegeu docs/SIMULATION.md.
//
// Els noms dels rols ('pickup', 'consumption', 'storage') són els mateixos
// que fa servir script.js a data-transport-role i els que van a l'arxiu:
// són un contracte estable entre les dues capes i el format de guardat.
const ProcessModel = (() => {
  'use strict';

  const ROLE_PICKUP = 'pickup';
  const ROLE_CONSUMPTION = 'consumption';
  const ROLE_STORAGE = 'storage';

  // Esquema de cada fitxa de configuració: quins camps té, de quin tipus,
  // amb quina unitat i amb quin valor per defecte. És l'única definició:
  // el formulari del panell, la validació i els valors per defecte en
  // surten tots d'aquí, de manera que afegir un camp és tocar una llista.
  //
  // `positive` vol dir estrictament més gran que 0 (la resta de números
  // només han de ser no negatius). Les etiquetes són el text que es veu a
  // la pantalla i van en català, com la resta de la interfície; les claus
  // van en anglès i són les que es desen a l'arxiu.
  const SCHEMAS = {
    [ROLE_STORAGE]: [
      { key: 'name', type: 'text', label: 'Nom', value: '' },
      { key: 'product', type: 'text', label: 'Producte', value: '' },
      { key: 'quantity', type: 'number', label: 'Quantitat inicial', unit: 'kg', value: 0 },
      { key: 'capacity', type: 'number', label: 'Capacitat màxima', unit: 'kg', value: 0 },
    ],
    [ROLE_CONSUMPTION]: [
      { key: 'name', type: 'text', label: 'Nom', value: '' },
      { key: 'product', type: 'text', label: 'Producte', value: '' },
      { key: 'quantity', type: 'number', label: 'Quantitat inicial', unit: 'kg', value: 0 },
      { key: 'capacity', type: 'number', label: 'Capacitat màxima', unit: 'kg', value: 0 },
    ],
    // El punt de recollida no porta ni quantitat ni capacitat: no
    // emmagatzema res, només recull. El producte no és un camp seu sinó que
    // l'hereta de l'element d'emmagatzematge que l'alimenta (vegeu
    // findUpstreamStorage), i per això no es desa: es torna a calcular.
    [ROLE_PICKUP]: [
      { key: 'name', type: 'text', label: 'Nom', value: '' },
    ],
    // La bomba bufadora no té rol: no recull, no consumeix i no
    // emmagatzema. Només li cal un nom, i per això té fitxa pròpia.
    pump: [
      { key: 'name', type: 'text', label: 'Nom', value: '' },
    ],
    // La línia NO té nom: ja té número, i el que interessa saber-ne és
    // quines bombes la poden fer funcionar, que és informació DERIVADA de
    // la topologia i per tant no es desa (vegeu detectPumps a script.js).
    line: [
      { key: 'throughput', type: 'number', label: 'Rendiment', unit: 'kg/h', value: 0, positive: true },
      { key: 'diameter', type: 'number', label: 'Diàmetre', unit: 'mm', value: 0 },
      { key: 'length', type: 'number', label: 'Longitud', unit: 'm', value: 0 },
    ],
  };

  function schemaFor(kind) {
    return SCHEMAS[kind] || [];
  }

  function defaultsFor(kind) {
    const values = {};
    schemaFor(kind).forEach((field) => { values[field.key] = field.value; });
    return values;
  }

  // ---- Seqüència d'accions ----
  // Una seqüència és una llista ORDENADA d'accions que s'executen una
  // darrere l'altra, sense solapaments: només n'hi ha una d'activa alhora.
  //
  // Cada acció és { order, type, lineId, duration }:
  //   · `order`    posició dins la seqüència, 1, 2, 3...
  //   · `type`     un dels ACTION_TYPES.
  //   · `lineId`   la línia de transport (la seva signatura, vegeu
  //                lineSignature). Obligatòria a les accions de transport.
  //   · `duration` en SEGONS, sempre més gran que 0. A la pantalla es
  //                veurà en minuts; el model no arrodoneix mai.
  //
  // Qui executa tot això és SimulationEngine (simulation.js); aquí només hi
  // viuen les dades.
  const ACTION_TYPES = {
    TRANSPORT: 'transport',
    REST: 'rest',
    SWEEP: 'sweep',
    STARTUP: 'startup',
  };

  const ACTION_LABELS = {
    [ACTION_TYPES.TRANSPORT]: 'Transport',
    [ACTION_TYPES.REST]: 'Descans',
    [ACTION_TYPES.SWEEP]: 'Barrido',
    [ACTION_TYPES.STARTUP]: 'Posada a règim',
  };

  // La seqüència es desa amb el model, com la resta: surt a serialize() i
  // torna a load(). Un arxiu d'abans que es desés no en porta, i llavors
  // queda buida, que és el que toca.
  let sequence = [];

  function createAction(values) {
    const source = values || {};
    return {
      order: Number(source.order) || 0,
      type: source.type || ACTION_TYPES.TRANSPORT,
      lineId: source.lineId || '',
      duration: Number(source.duration) || 0,
    };
  }

  // Renumera l'ordre 1..n a partir de la posició real a la llista, de
  // manera que l'ordre no pugui quedar mai desparellat amb la seqüència.
  // No valida res: de dir què està malament se n'encarrega el motor, que
  // és qui sap donar el missatge sencer.
  function normalizeSequence(actions) {
    return (Array.isArray(actions) ? actions : []).map((action, index) => {
      const normalized = createAction(action);
      normalized.order = index + 1;
      return normalized;
    });
  }

  // ---- Magatzem ----
  // Dos diccionaris plans. `elements` va indexat per l'identificador de
  // l'element (silo-3, hopper-12...), que no es reutilitza mai mentre el
  // model viu; `lines` va indexat per la signatura de la línia (vegeu
  // lineSignature), no pel seu número visible, que canvia a cada recàlcul.
  //
  // Cap de les dues entrades s'esborra sola quan desapareix l'element o la
  // línia corresponent: queden com a òrfenes i tornen a aparèixer soles si
  // es desfà el canvi al diagrama. Esborrar-les és sempre una acció
  // explícita de l'usuari (o de "Neteja tot", que buida el model sencer).
  let store = { elements: {}, lines: {} };

  function readEntry(bucket, id, kind) {
    const stored = store[bucket][id];
    return { ...defaultsFor(kind), ...(stored || {}) };
  }

  function writeEntry(bucket, id, kind, values) {
    const entry = { ...defaultsFor(kind), ...(store[bucket][id] || {}) };
    schemaFor(kind).forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(values, field.key)) {
        entry[field.key] = values[field.key];
      }
    });
    store[bucket][id] = entry;
    return entry;
  }

  // ---- Signatura d'una línia de transport ----
  // Les línies són informació derivada de la topologia: es tornen a
  // detectar a cada recàlcul i el seu número visible pot canviar. La
  // signatura és el que permet que la configuració de l'usuari sobrevisqui
  // a aquests recàlculs, i per això es construeix NOMÉS amb coses estables:
  // l'element de recollida d'origen, el de consum de destí i la seqüència
  // ordenada d'identificadors d'element del recorregut. No hi entren ni les
  // coordenades, ni l'ordre de detecció, ni el número de línia.
  //
  // Els connectors (les canonades) queden deliberadament fora: així,
  // desfer una connexió i tornar-la a fer recupera la configuració encara
  // que la canonada nova no surti exactament pels mateixos punts.
  function lineSignature(line) {
    return [
      line.pickupPointId,
      line.consumptionPointId,
      (line.pathElementIds || []).join('>'),
    ].join('|');
  }

  // ---- Cerca de l'element d'emmagatzematge aigües amunt ----
  // Recorregut en amplada des del punt de recollida seguint les connexions
  // reals, mai la proximitat gràfica. Els elements amb rol són finals de
  // recorregut (no s'hi passa a través); la resta es travessen lliurement.
  // El primer element amb rol d'emmagatzematge que es troba és la font.
  //
  // `graph` és un diccionari pla { id: { type, role, ports } }, on cada
  // port porta { otherId, otherPort }: qui el construeix és script.js, que
  // és qui sap llegir el canvas. `canCross(type, fromPort, toPort)` és
  // opcional i serveix per respectar les restriccions de forma d'un element
  // (la desviadora, que no deixa passar el producte d'una branca a l'altra);
  // si no es passa, tot element sense rol es travessa de punt a punt.
  //
  // Es recorren estats (element, port d'entrada) i no només elements,
  // perquè en un element amb restriccions el camí que es pot continuar
  // depèn de per on s'hi ha entrat.
  function findUpstreamStorage(graph, startId, canCross) {
    const start = graph[startId];
    if (!start) return { status: 'none', storageId: '', path: [], candidates: [] };

    const crossable = typeof canCross === 'function' ? canCross : () => true;
    const seen = new Set([`${startId}:`]);
    const candidates = [];
    let queue = [{ id: startId, enteredPort: null, path: [startId] }];
    let distance = 0;

    while (queue.length && !candidates.length) {
      const next = [];
      distance += 1;

      queue.forEach((state) => {
        const node = graph[state.id];
        Object.keys(node.ports).sort().forEach((port) => {
          if (port === state.enteredPort) return;
          if (state.enteredPort !== null && !crossable(node.type, state.enteredPort, port)) return;

          const link = node.ports[port];
          const neighbour = graph[link.otherId];
          if (!neighbour) return;

          const key = `${link.otherId}:${link.otherPort}`;
          if (seen.has(key)) return;
          seen.add(key);

          const path = [...state.path, link.otherId];

          // Un element amb rol tanca el camí, sigui quin sigui: o bé és la
          // font que busquem, o bé és un altre extrem de la instal·lació
          // pel qual el producte no hi passa de llarg.
          if (neighbour.role) {
            if (neighbour.role === ROLE_STORAGE && !candidates.some((c) => c.id === link.otherId)) {
              candidates.push({ id: link.otherId, path, distance });
            }
            return;
          }

          next.push({ id: link.otherId, enteredPort: link.otherPort, path });
        });
      });

      queue = next;
    }

    // Tots els candidats surten de la mateixa passada del recorregut en
    // amplada i, per tant, són a la mateixa distància mínima. Si n'hi ha
    // més d'un no se'n tria cap: qui decideix és l'usuari.
    if (!candidates.length) return { status: 'none', storageId: '', path: [], candidates: [] };
    if (candidates.length > 1) return { status: 'ambiguous', storageId: '', path: [], candidates };
    return { status: 'found', storageId: candidates[0].id, path: candidates[0].path, candidates };
  }

  // Font d'un punt de recollida tenint en compte l'elecció manual de
  // l'usuari, que mana sempre sobre la detecció automàtica mentre l'element
  // triat continuï existint i sent un element d'emmagatzematge. Si ja no
  // apareix entre els candidats detectats, l'elecció es respecta igualment
  // però es marca com a `stale` perquè la pantalla ho pugui avisar.
  // `choiceOverride` permet resoldre amb una elecció que l'usuari acaba de
  // fer al panell i encara no ha desat; sense ell es fa servir la desada.
  function resolvePickupSource(graph, pickupId, canCross, choiceOverride) {
    const detected = findUpstreamStorage(graph, pickupId, canCross);
    const stored = readEntry('elements', pickupId, ROLE_PICKUP).storageChoice || '';
    const choice = choiceOverride === undefined ? stored : choiceOverride;
    if (!choice) return detected;

    const chosen = graph[choice];
    if (!chosen || chosen.role !== ROLE_STORAGE) return detected;

    const match = detected.candidates.find((candidate) => candidate.id === choice);
    return {
      status: 'chosen',
      storageId: choice,
      path: match ? match.path : [],
      candidates: detected.candidates,
      stale: !match,
    };
  }

  // ---- Números ----
  // S'accepta la coma decimal, que és com s'escriu aquí, però tot es desa
  // com un número sense arrodonir: l'arrodoniment és només de pantalla.
  function parseNumber(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const text = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (!text) return 0;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function formatKg(value) {
    const number = typeof value === 'number' ? value : parseNumber(value) || 0;
    return number.toLocaleString('ca-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  // Comprova un formulari sencer contra l'esquema i retorna els valors ja
  // convertits. Mai desa res: qui crida decideix què en fa.
  function validate(kind, values) {
    const errors = {};
    const clean = {};

    schemaFor(kind).forEach((field) => {
      const raw = values[field.key];

      if (field.type !== 'number') {
        clean[field.key] = String(raw == null ? '' : raw).trim();
        return;
      }

      const value = parseNumber(raw);
      if (value === null) errors[field.key] = 'Ha de ser un número.';
      else if (value < 0) errors[field.key] = 'No pot ser negatiu.';
      else if (field.positive && value <= 0) errors[field.key] = 'Ha de ser més gran que 0.';
      else clean[field.key] = value;
    });

    return { ok: Object.keys(errors).length === 0, values: clean, errors };
  }

  return {
    ROLES: { PICKUP: ROLE_PICKUP, CONSUMPTION: ROLE_CONSUMPTION, STORAGE: ROLE_STORAGE },
    ACTION_TYPES,
    ACTION_LABELS,

    schemaFor,
    defaultsFor,

    // Seqüència d'accions. getSequence() retorna una còpia: qui la demana
    // no pot modificar la de dins sense passar per setSequence().
    getSequence: () => sequence.map((action) => ({ ...action })),
    setSequence: (actions) => { sequence = normalizeSequence(actions); },
    createAction,
    normalizeSequence,

    // Configuració d'un element, per rol. `has` distingeix un element que
    // l'usuari ha configurat d'un que encara no ha tocat mai.
    getElement: (id, role) => readEntry('elements', id, role),
    setElement: (id, role, values) => writeEntry('elements', id, role, values),
    hasElement: (id) => Object.prototype.hasOwnProperty.call(store.elements, id),
    deleteElement: (id) => { delete store.elements[id]; },

    // L'elecció manual de font d'un punt de recollida es desa amb la resta
    // de la fitxa de l'element, però fora de l'esquema: no és un camp del
    // formulari sinó una decisió que mana sobre un càlcul.
    getPickupChoice: (id) => (store.elements[id] || {}).storageChoice || '',
    setPickupChoice: (id, storageId) => {
      const entry = { ...defaultsFor(ROLE_PICKUP), ...(store.elements[id] || {}) };
      entry.storageChoice = storageId || '';
      store.elements[id] = entry;
    },

    // Configuració d'una línia de transport, indexada per signatura.
    getLine: (signature) => readEntry('lines', signature, 'line'),
    setLine: (signature, values) => writeEntry('lines', signature, 'line', values),
    hasLine: (signature) => Object.prototype.hasOwnProperty.call(store.lines, signature),
    deleteLine: (signature) => { delete store.lines[signature]; },

    // Configuracions de línia que ara mateix no corresponen a cap línia
    // detectada. No s'esborren soles: si es desfà el canvi al diagrama, la
    // línia torna amb la seva configuració.
    orphanLines: (activeSignatures) => {
      const active = new Set(activeSignatures);
      return Object.keys(store.lines).filter((signature) => !active.has(signature)).sort();
    },

    lineSignature,
    findUpstreamStorage,
    resolvePickupSource,
    parseNumber,
    formatKg,
    validate,

    // ---- Persistència ----
    // El model sencer entra i surt com un objecte pla. Tot el que ve de
    // fora es tracta com a dubtós (un arxiu pot venir d'una versió
    // anterior o estar tocat a mà): el que no encaixi s'ignora i la resta
    // s'obre igualment.
    serialize: () => ({
      elements: JSON.parse(JSON.stringify(store.elements)),
      lines: JSON.parse(JSON.stringify(store.lines)),
      sequence: sequence.map((action) => ({ ...action })),
    }),

    load: (data) => {
      store = { elements: {}, lines: {} };
      sequence = [];
      if (!data || typeof data !== 'object') return;

      ['elements', 'lines'].forEach((bucket) => {
        const source = data[bucket];
        if (!source || typeof source !== 'object') return;
        Object.keys(source).forEach((id) => {
          const entry = source[id];
          if (entry && typeof entry === 'object') store[bucket][id] = { ...entry };
        });
      });

      // normalizeSequence renumera l'ordre i posa els valors per defecte al
      // que falti, de manera que un arxiu tocat a mà no pot deixar la
      // seqüència en un estat estrany.
      if (Array.isArray(data.sequence)) sequence = normalizeSequence(data.sequence);
    },

    clear: () => { store = { elements: {}, lines: {} }; sequence = []; },
  };
})();
