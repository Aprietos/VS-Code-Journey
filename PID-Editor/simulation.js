// ---- Motor de càlcul de la simulació ----
// Capa de càlcul pura: no toca el DOM, no dibuixa res i NO modifica mai les
// dades del projecte. Rep un "escenari" (objecte pla amb la situació
// inicial i la seqüència d'accions) i retorna resultats nous.
//
// El càlcul NO és acumulatiu. No s'avança instant a instant sumant
// increments petits, perquè això acumula error, fa que el resultat depengui
// de la mida del pas i impedeix moure el cursor enrere amb precisió. En
// comptes d'això:
//
//   1. compile() calcula per endavant TOTS els moments clau: l'inici i el
//      final de cada acció i, quan un element d'emmagatzematge s'esgota
//      enmig d'una acció, l'instant exacte en què passa (massa dividida per
//      cabal, no provant instants).
//   2. Entre dos moments clau consecutius tot varia de manera perfectament
//      lineal. Cada tram guarda la situació EXACTA al seu inici i el cabal
//      de cada element durant el tram.
//   3. stateAt() és llavors trobar el tram i interpolar.
//
// D'aquí surt la garantia que importa: stateAt(compilat, t) és una funció
// pura de (compilat, t). Consultar el minut 3 dona sempre exactament el
// mateix resultat, s'hi arribi com s'hi arribi i a la velocitat que sigui.
//
// Les accions NO són seqüencials: cada una porta la seva bomba i el seu
// instant d'inici, i diverses poden estar actives alhora. compile() fa una
// escombrada per esdeveniments (vegeu-hi el comentari) i, quan diverses
// línies buiden el mateix element d'emmagatzematge, el cabal de sortida és
// la SUMA de totes, que és el que decideix quan es buida.
//
// El temps va sempre en SEGONS. Els cabals de configuració van en kg/h.
// Vegeu docs/SIMULATION.md.
const SimulationEngine = (() => {
  'use strict';

  const SECONDS_PER_HOUR = 3600;

  // Quins tipus d'acció mouen producte.
  //
  // AQUEST ÉS EL LLOC on s'hi afegeix comportament físic nou. Avui el
  // barrido i la posada a règim només ocupen temps. El dia que hagin de
  // moure alguna cosa (arrossegar el producte que queda a la canonada,
  // per exemple), el canvi comença en aquesta taula i continua a
  // l'escombrada de compile(), que és qui decideix quins cabals hi ha
  // actius a cada tram.
  //
  // Les claus han de coincidir amb ProcessModel.ACTION_TYPES; hi ha una
  // prova automàtica que comprova que no se'n desincronitzin.
  const MOVES_PRODUCT = {
    transport: true,
    rest: false,
    sweep: false,
    startup: false,
  };

  // Quins tipus d'acció ocupen la CANONADA (i, per tant, no poden anar
  // alhora que una altra que comparteixi recorregut). El transport hi passa
  // producte i el barrido hi passa aire, i tots dos necessiten la canonada
  // per a ells sols; el descans i la posada a règim només ocupen la bomba.
  const OCCUPIES_PIPE = {
    transport: true,
    rest: false,
    sweep: true,
    startup: false,
  };

  // Sostre dur de trams, per garantir que l'escombrada acaba sempre encara
  // que algun dia s'hi afegeixi una condició que es realimenti. Amb N
  // accions i M magatzems no en poden sortir més de 2N+M+1.
  const MAX_SEGMENTS = 5000;

  // ---- Textos ----
  // Els missatges els llegirà un enginyer, no un programador: han de dir
  // què passa i què s'ha de fer, sense termes tècnics ni identificadors.
  function actionLabel(type) {
    const labels = (typeof ProcessModel !== 'undefined' && ProcessModel.ACTION_LABELS) || {};
    return labels[type] || type;
  }

  function kgLabel(value) {
    return `${Number(value).toLocaleString('ca-ES', { maximumFractionDigits: 1 })} kg`;
  }

  // El temps es guarda en segons però als missatges es diu en minuts, que
  // és com el llegirà l'usuari.
  function minuteLabel(seconds) {
    const minutes = Math.round((seconds / 60) * 100) / 100;
    return minutes.toLocaleString('ca-ES', { maximumFractionDigits: 2 });
  }

  function issue(code, message, extra) {
    return { code, message, ...(extra || {}) };
  }

  function nameOf(entity, id) {
    const name = entity && entity.name ? String(entity.name).trim() : '';
    return name || id;
  }

  // ---- Validació ----
  // Tot el que pugui impedir un càlcul correcte es detecta AQUÍ, abans de
  // començar, mai enmig de la simulació. Els errors bloquegen; els avisos
  // (que es calculen més avall, un cop fets els trams) no.
  function collectErrors(scenario) {
    const errors = [];
    const actions = Array.isArray(scenario.actions) ? scenario.actions : [];
    const lines = scenario.lines || {};
    const storages = scenario.storages || {};
    const consumptions = scenario.consumptions || {};

    if (!actions.length) {
      errors.push(issue('empty-sequence', 'La seqüència no té cap acció: no hi ha res a simular.'));
    }

    // Les línies es comproven una sola vegada encara que surtin a diverses
    // accions, perquè l'usuari no vegi cinc cops el mateix error.
    const usedLines = new Set();

    actions.forEach((action, index) => {
      const order = action.order || index + 1;
      const where = `Acció ${order}`;
      const what = actionLabel(action.type);

      if (!Object.prototype.hasOwnProperty.call(MOVES_PRODUCT, action.type)) {
        errors.push(issue('unknown-action-type',
          `${where}: «${action.type}» no és cap dels tipus d'acció que el programa coneix.`,
          { actionOrder: order }));
        return;
      }

      if (!(Number(action.duration) > 0)) {
        errors.push(issue('invalid-duration',
          `${where} (${what}): la durada ha de ser més gran que zero.`,
          { actionOrder: order }));
      }

      if (!(Number(action.startTime) >= 0)) {
        errors.push(issue('invalid-start',
          `${where} (${what}): l'instant d'inici no pot ser negatiu.`,
          { actionOrder: order }));
      }

      // La resta de comprovacions només tenen sentit per a les accions que
      // mouen producte; un descans no necessita cap línia.
      if (!MOVES_PRODUCT[action.type]) return;

      if (!action.lineId) {
        errors.push(issue('missing-line',
          `${where} (${what}): no té cap línia de transport assignada.`,
          { actionOrder: order }));
        return;
      }

      if (!lines[action.lineId]) {
        errors.push(issue('missing-line',
          `${where} (${what}): la línia de transport que tenia assignada ja no existeix al diagrama.`,
          { actionOrder: order, lineId: action.lineId }));
        return;
      }

      usedLines.add(action.lineId);
    });

    [...usedLines].sort().forEach((lineId) => {
      const line = lines[lineId];
      const lineName = nameOf(line, lineId);
      const Line = `La línia «${lineName}»`;
      const line_ = `la línia «${lineName}»`;
      const pickup = line.pickupName ? `«${line.pickupName}»` : 'el seu Pickup Point';

      if (line.configured === false) {
        errors.push(issue('line-not-configured',
          `${Line} encara no està configurada: obre-la i posa-hi un rendiment en kg/h.`,
          { lineId }));
      } else if (!(Number(line.throughput) > 0)) {
        errors.push(issue('line-no-throughput',
          `${Line} no té rendiment: ha de ser més gran que 0 kg/h.`, { lineId }));
      }

      if (!line.pickupId) {
        errors.push(issue('line-without-source',
          `${Line} no té cap Pickup Point d'origen.`, { lineId }));
      }

      if (!line.consumptionId || !consumptions[line.consumptionId]) {
        errors.push(issue('line-without-target',
          `${Line} no té cap punt de consum de destí.`, { lineId }));
      }

      if (line.storageStatus === 'ambiguous') {
        errors.push(issue('storage-ambiguous',
          `${Line} surt de ${pickup}, que té més d'un element d'emmagatzematge candidat i encara no se n'ha triat cap. Obre la seva fitxa i tria d'on ve el producte.`,
          { lineId }));
        return;
      }

      if (!line.storageId || !storages[line.storageId]) {
        errors.push(issue('storage-not-detected',
          `${Line} surt de ${pickup}, que no té cap element d'emmagatzematge que l'alimenti: el programa no sap d'on surt el producte.`,
          { lineId }));
        return;
      }

      const storage = storages[line.storageId];
      const storageName = nameOf(storage, line.storageId);

      if (!(Number(storage.quantity) > 0)) {
        errors.push(issue('storage-empty',
          `L'element d'emmagatzematge «${storageName}», que alimenta ${line_}, no té gens de producte (0 kg).`,
          { lineId, storageId: line.storageId }));
      }

      const target = consumptions[line.consumptionId];
      if (target) {
        const from = String(storage.product || '').trim();
        const to = String(target.product || '').trim();
        // Un producte en blanc vol dir "encara no definit" i no contradiu
        // res: només és incompatible si les dues bandes en tenen un i són
        // diferents.
        if (from && to && from.toLowerCase() !== to.toLowerCase()) {
          errors.push(issue('product-mismatch',
            `${Line} porta «${from}» des de «${storageName}» fins a «${nameOf(target, line.consumptionId)}», que conté «${to}». Els productes no coincideixen.`,
            { lineId, storageId: line.storageId, consumptionId: line.consumptionId }));
        }
      }
    });

    errors.push(...collectConflicts(scenario));
    return errors;
  }

  // ---- Conflictes entre accions simultànies ----
  // Dues accions que se solapen en el temps no poden compartir ni la bomba
  // ni la canonada.
  //
  // La regla de canonada és: comparteixen canonada si els RECORREGUTS de
  // les seves línies tenen algun element en comú, el punt de recollida i el
  // de consum inclosos. Mirar els elements ja cobreix els trams de
  // canonada: si dues rutes comparteixen una canonada, comparteixen per
  // força els dos elements que uneix. I al revés no: dues rutes poden
  // passar per la mateixa desviadora per branques diferents sense compartir
  // cap tram, i això TAMBÉ és un conflicte, perquè la desviadora no pot
  // estar posada de dues maneres alhora.
  function actionWindow(action) {
    const start = Number(action.startTime) || 0;
    return { start, end: start + (Number(action.duration) || 0) };
  }

  function overlaps(a, b) {
    // Tocar-se no és solapar-se: una acció pot començar just quan acaba
    // l'altra.
    return a.start < b.end && b.start < a.end;
  }

  function actionLabelFor(action) {
    const what = actionLabel(action.type);
    return `l'acció ${action.order} (${what})`;
  }

  function collectConflicts(scenario) {
    const errors = [];
    const actions = Array.isArray(scenario.actions) ? scenario.actions : [];
    const lines = scenario.lines || {};
    const pumps = scenario.pumps || {};

    const pumpLabel = (id) => (pumps[id] && pumps[id].name) || (id ? id : 'sense bomba');

    const routeOf = (action) => {
      const line = lines[action.lineId];
      const route = line && line.route;
      return OCCUPIES_PIPE[action.type] && action.lineId && route && Array.isArray(route.elements)
        ? route
        : null;
    };

    for (let i = 0; i < actions.length; i += 1) {
      for (let j = i + 1; j < actions.length; j += 1) {
        const a = actions[i];
        const b = actions[j];
        const wa = actionWindow(a);
        const wb = actionWindow(b);
        if (!overlaps(wa, wb)) continue;

        const from = Math.max(wa.start, wb.start);
        const to = Math.min(wa.end, wb.end);
        const when = `del minut ${minuteLabel(from)} al ${minuteLabel(to)}`;

        // Una bomba no pot fer dues coses alhora.
        if ((a.pumpId || '') === (b.pumpId || '')) {
          errors.push(issue('pump-conflict',
            `${capitalize(actionLabelFor(a))} i ${actionLabelFor(b)} són totes dues de `
            + `«${pumpLabel(a.pumpId)}» i se solapen ${when}. Una bomba no pot fer dues `
            + 'coses alhora: mou-ne una o canvia-la de bomba.',
            { actionOrder: a.order, otherOrder: b.order, fromSeconds: from, toSeconds: to }));
          continue;
        }

        // Bombes diferents: el problema és la canonada.
        const ra = routeOf(a);
        const rb = routeOf(b);
        if (!ra || !rb) continue;

        const other = new Set(rb.elements);
        const shared = ra.elements.filter((id) => other.has(id));
        if (!shared.length) continue;

        const names = shared
          .map((id) => (ra.labels && ra.labels[id]) || (rb.labels && rb.labels[id]) || id)
          .slice(0, 3);
        const more = shared.length > names.length ? ` i ${shared.length - names.length} més` : '';

        errors.push(issue('pipe-conflict',
          `${capitalize(actionLabelFor(a))} («${pumpLabel(a.pumpId)}») i ${actionLabelFor(b)} `
          + `(«${pumpLabel(b.pumpId)}») se solapen ${when} i totes dues passen per `
          + `${names.map((name) => `«${name}»`).join(', ')}${more}. `
          + 'Dues accions alhora no poden compartir cap tram de la instal·lació.',
          {
            actionOrder: a.order,
            otherOrder: b.order,
            fromSeconds: from,
            toSeconds: to,
            sharedElementIds: shared,
          }));
      }
    }

    return errors;
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ---- Compilació ----
  // Converteix l'escenari en una llista de trams amb tot precalculat. És
  // l'única funció que "simula"; la resta només consulta el que hi ha aquí.
  function compile(scenario) {
    const safe = scenario || {};
    const errors = collectErrors(safe);

    if (errors.length) {
      return {
        ok: false,
        errors,
        warnings: [],
        segments: [],
        actions: [],
        keyTimes: [],
        totalDuration: 0,
        final: { storages: {}, consumptions: {}, lines: {} },
      };
    }

    const storageIds = Object.keys(safe.storages || {}).sort();
    const consumptionIds = Object.keys(safe.consumptions || {}).sort();
    const lineIds = Object.keys(safe.lines || {}).sort();

    // Estat que es va arrossegant d'un tram al següent. Els valors finals
    // de cada tram es calculen una sola vegada aquí i es fan servir com a
    // inici EXACTE del tram següent: així no s'acumula error d'interpolació.
    const current = { storages: {}, consumptions: {}, lines: {} };
    storageIds.forEach((id) => { current.storages[id] = Number(safe.storages[id].quantity) || 0; });
    consumptionIds.forEach((id) => { current.consumptions[id] = Number(safe.consumptions[id].quantity) || 0; });
    lineIds.forEach((id) => { current.lines[id] = 0; });

    const segments = [];
    const warnings = [];
    const emptiedAt = {};    // element -> segon en què es buida (el primer cop)
    const exceededAt = {};   // punt de consum -> segon en què passa de capacitat

    // Un punt de consum que JA comença per sobre de la seva capacitat també
    // compta com a superada, des del segon zero.
    consumptionIds.forEach((id) => {
      const target = safe.consumptions[id];
      const capacity = Number(target.capacity) || 0;
      if (capacity > 0 && current.consumptions[id] > capacity) exceededAt[id] = 0;
    });

    // Accions amb el seu instant d'inici i el seu final, en absolut. Cada
    // una porta la seva bomba: diverses poden estar actives alhora, sempre
    // que la validació no hi hagi trobat cap conflicte.
    const actions = (safe.actions || []).map((action) => {
      const startTime = Number(action.startTime) || 0;
      const duration = Number(action.duration) || 0;
      return {
        order: action.order,
        type: action.type,
        pumpId: action.pumpId || '',
        lineId: action.lineId || '',
        startTime,
        duration,
        endTime: startTime + duration,
        moving: false,
        transferred: 0,
        complete: true,
        incompleteReason: '',
      };
    });

    const totalDuration = actions.reduce((max, action) => Math.max(max, action.endTime), 0);

    // Instants en què alguna cosa canvia per si sola: els inicis i els
    // finals de TOTES les accions, de totes les bombes.
    const boundaries = [...new Set([0, ...actions.map((a) => a.startTime), ...actions.map((a) => a.endTime)])]
      .filter((value) => value >= 0 && value <= totalDuration)
      .sort((x, y) => x - y);

    // Afegeix un tram i avança l'estat fins al seu final.
    //
    // `flows` són les línies que mouen producte durant el tram, cadascuna
    // amb el seu cabal. `emptyingId`, si n'hi ha, és el magatzem que es
    // buida JUSTAMENT al final del tram: llavors el que en surt és
    // exactament el que hi quedava, i la resta dona zero clavat en comptes
    // d'una engruna en coma flotant.
    function pushSegment(from, to, activeActions, flows, emptyingId) {
      const seconds = to - from;

      // Cabals nets. Quan diverses línies treuen del mateix magatzem, el
      // cabal de sortida és la SUMA: és el que fa que es buidi abans.
      const storageRate = {};
      const consumptionRate = {};
      const lineRate = {};

      flows.forEach((flow) => {
        storageRate[flow.storageId] = (storageRate[flow.storageId] || 0) + flow.perHour;
        consumptionRate[flow.consumptionId] = (consumptionRate[flow.consumptionId] || 0) + flow.perHour;
        lineRate[flow.lineId] = (lineRate[flow.lineId] || 0) + flow.perHour;
      });

      const entry = (value, perHour) => ({
        start: value,
        ratePerHour: perHour,              // el número autoritatiu
        rate: perHour / SECONDS_PER_HOUR,  // el mateix en kg/s, per ensenyar-lo
      });

      const segment = {
        index: segments.length,
        startTime: from,
        endTime: to,
        actionOrders: activeActions.map((action) => action.order),
        movingLineIds: flows.map((flow) => flow.lineId),
        moving: flows.length > 0,
        storages: {},
        consumptions: {},
        lines: {},
      };

      storageIds.forEach((id) => {
        segment.storages[id] = entry(current.storages[id], -(storageRate[id] || 0));
      });
      consumptionIds.forEach((id) => {
        segment.consumptions[id] = entry(current.consumptions[id], consumptionRate[id] || 0);
      });
      lineIds.forEach((id) => {
        segment.lines[id] = entry(current.lines[id], lineRate[id] || 0);
      });

      segments.push(segment);

      // Quant surt de cada magatzem durant el tram. El que es buida just al
      // final en dona exactament el que li quedava.
      const drawn = {};
      Object.keys(storageRate).forEach((id) => {
        drawn[id] = id === emptyingId
          ? current.storages[id]
          : (storageRate[id] * seconds) / SECONDS_PER_HOUR;
      });

      flows.forEach((flow) => {
        // Amb una sola línia, la part és tot el que ha sortit, sense cap
        // divisió pel mig: els números en sèrie surten idèntics als d'abans.
        const total = storageRate[flow.storageId];
        const share = flow.perHour === total
          ? drawn[flow.storageId]
          : (drawn[flow.storageId] * flow.perHour) / total;

        // Avís de capacitat: l'instant exacte en què el punt de consum passa
        // de la seva capacitat màxima, dins d'aquest tram.
        const target = safe.consumptions[flow.consumptionId];
        const capacity = Number(target.capacity) || 0;
        const before = current.consumptions[flow.consumptionId];
        const rate = consumptionRate[flow.consumptionId];
        if (capacity > 0 && exceededAt[flow.consumptionId] === undefined
            && before + (rate * seconds) / SECONDS_PER_HOUR > capacity) {
          exceededAt[flow.consumptionId] = before >= capacity
            ? from
            : from + ((capacity - before) * SECONDS_PER_HOUR) / rate;
        }

        current.consumptions[flow.consumptionId] += share;
        current.lines[flow.lineId] += share;
        flow.action.transferred += share;
        flow.action.moving = true;
      });

      Object.keys(drawn).forEach((id) => {
        current.storages[id] -= drawn[id];
        if (current.storages[id] <= 0) {
          current.storages[id] = 0;
          if (emptiedAt[id] === undefined) emptiedAt[id] = to;
        }
      });
    }

    // ---- Escombrada per esdeveniments ----
    // A cada pas es mira quines accions estan actives, es reparteixen els
    // cabals i es talla el tram al primer esdeveniment que passi: o bé una
    // frontera d'acció, o bé un magatzem que es buida. Entre dos talls tot
    // varia de manera perfectament lineal, que és el que permet que
    // consultar un instant sigui interpolar i prou.
    let time = 0;
    let guard = 0;

    while (time < totalDuration && guard < MAX_SEGMENTS) {
      guard += 1;

      const activeActions = actions.filter(
        (action) => action.startTime <= time && time < action.endTime,
      );

      // Línies que mouen producte ara mateix. Una línia el magatzem de la
      // qual ja és buit no mou res, i la seva acció queda incompleta.
      const flows = [];
      activeActions.forEach((action) => {
        if (!MOVES_PRODUCT[action.type]) return;

        const line = safe.lines[action.lineId];
        if (!line) return;

        const perHour = Number(line.throughput);
        if (!(perHour > 0)) return;

        if (!(current.storages[line.storageId] > 0)) {
          action.complete = false;
          action.incompleteReason = 'storage-empty';
          return;
        }

        flows.push({
          action,
          lineId: action.lineId,
          storageId: line.storageId,
          consumptionId: line.consumptionId,
          perHour,
        });
      });

      // Fins on arriba el tram: la frontera d'acció següent...
      const nextBoundary = boundaries.find((value) => value > time);
      let segmentEnd = nextBoundary === undefined ? totalDuration : Math.min(nextBoundary, totalDuration);

      // ...o abans, si algun magatzem es buida pel mig. L'instant surt de
      // dividir la massa que queda per la SUMA dels cabals que en treuen.
      const storageRate = {};
      flows.forEach((flow) => {
        storageRate[flow.storageId] = (storageRate[flow.storageId] || 0) + flow.perHour;
      });

      let emptyingId = '';
      Object.keys(storageRate).forEach((id) => {
        const when = time + (current.storages[id] * SECONDS_PER_HOUR) / storageRate[id];
        if (when < segmentEnd) {
          segmentEnd = when;
          emptyingId = id;
        }
      });

      pushSegment(time, segmentEnd, activeActions, flows, emptyingId);
      time = segmentEnd;
    }

    // ---- Avisos (no bloquegen) ----
    Object.keys(emptiedAt).sort().forEach((id) => {
      warnings.push(issue('storage-will-empty',
        `L'element d'emmagatzematge «${nameOf(safe.storages[id], id)}» es buidarà al minut ${minuteLabel(emptiedAt[id])} de la seqüència.`,
        { storageId: id, atSeconds: emptiedAt[id] }));
    });

    // Una línia sense cap bomba bufadora no té què la faci funcionar. És un
    // avís i no un error: el càlcul de quilos no en depèn gens, però qui
    // munti la instal·lació ho ha de saber.
    const pumpless = new Set();
    (safe.actions || []).forEach((action) => {
      if (!MOVES_PRODUCT[action.type]) return;
      const line = safe.lines[action.lineId];
      if (line && !(Array.isArray(line.pumps) && line.pumps.length)) pumpless.add(action.lineId);
    });

    [...pumpless].sort().forEach((lineId) => {
      warnings.push(issue('line-without-pump',
        `${nameOf(safe.lines[lineId], lineId)} no té cap bomba bufadora que la pugui fer funcionar.`,
        { lineId, atSeconds: 0 }));
    });

    Object.keys(exceededAt).sort().forEach((id) => {
      const target = safe.consumptions[id];
      warnings.push(issue('capacity-exceeded',
        `El punt de consum «${nameOf(target, id)}» passa de la seva capacitat màxima (${kgLabel(target.capacity)}) al minut ${minuteLabel(exceededAt[id])}: hi acabaran arribant ${kgLabel(current.consumptions[id])}.`,
        { consumptionId: id, atSeconds: exceededAt[id] }));
    });

    warnings.sort((a, b) => a.atSeconds - b.atSeconds || (a.code < b.code ? -1 : 1));

    const keyTimes = [0, ...segments.map((segment) => segment.endTime)]
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort((a, b) => a - b);

    return {
      ok: true,
      errors: [],
      warnings,
      segments,
      actions,
      keyTimes,
      totalDuration,
      // Situació al final de la seqüència, calculada i no interpolada, per
      // no dependre de l'arrodoniment just a l'últim instant.
      final: {
        storages: { ...current.storages },
        consumptions: { ...current.consumptions },
        lines: { ...current.lines },
      },
    };
  }

  // ---- Consulta d'estat ----
  // Troba el tram que conté l'instant demanat. Es queda amb l'ÚLTIM tram
  // que comença en aquest instant o abans: així, just a la frontera entre
  // dos trams, s'agafa el valor exacte guardat com a inici del tram nou en
  // comptes d'interpolar-lo.
  function segmentAt(compiled, seconds) {
    const segments = compiled.segments;
    let low = 0;
    let high = segments.length - 1;
    let found = 0;

    while (low <= high) {
      const middle = (low + high) >> 1;
      if (segments[middle].startTime <= seconds) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return segments[found];
  }

  function valueAt(entry, elapsed) {
    if (!entry.ratePerHour) return entry.start;
    return entry.start + (entry.ratePerHour * elapsed) / SECONDS_PER_HOUR;
  }

  // Estat complet en un instant. És una funció PURA de (compiled, seconds):
  // no guarda res, no depèn de cap consulta anterior i, per tant, dona
  // sempre el mateix resultat per al mateix instant.
  function stateAt(compiled, seconds) {
    const total = compiled.totalDuration;
    const time = Math.min(Math.max(Number(seconds) || 0, 0), total);

    const state = {
      time,
      totalDuration: total,
      finished: time >= total,
      // Diverses accions poden estar actives alhora, una per bomba.
      actions: [],
      activeLineIds: [],
      storages: {},
      consumptions: {},
      lines: {},
      warnings: [],
    };

    if (!compiled.ok || !compiled.segments.length) return state;

    // Al final de tot es fan servir els valors calculats, no els interpolats.
    if (time >= total) {
      state.storages = { ...compiled.final.storages };
      state.consumptions = { ...compiled.final.consumptions };
      state.lines = { ...compiled.final.lines };
    } else {
      const segment = segmentAt(compiled, time);
      const elapsed = time - segment.startTime;
      Object.keys(segment.storages).forEach((id) => {
        // Un element d'emmagatzematge no pot tenir massa negativa; si la
        // interpolació deixa una engruna per sota de zero, és zero.
        const value = valueAt(segment.storages[id], elapsed);
        state.storages[id] = value > 0 ? value : 0;
      });
      Object.keys(segment.consumptions).forEach((id) => {
        state.consumptions[id] = valueAt(segment.consumptions[id], elapsed);
      });
      Object.keys(segment.lines).forEach((id) => {
        state.lines[id] = valueAt(segment.lines[id], elapsed);
      });
    }

    const segment = segmentAt(compiled, Math.min(time, total));

    // Just al final de tot ja no hi ha res actiu.
    const running = time < total;

    state.actions = running
      ? segment.actionOrders
        .map((order) => compiled.actions.find((item) => item.order === order))
        .filter(Boolean)
        .map((action) => ({
          order: action.order,
          type: action.type,
          pumpId: action.pumpId,
          lineId: action.lineId,
          startTime: action.startTime,
          endTime: action.endTime,
          duration: action.duration,
          progress: action.duration > 0
            ? Math.min(Math.max((time - action.startTime) / action.duration, 0), 1)
            : 1,
          // Mou producte ARA mateix? Una acció que s'ha quedat sense
          // magatzem continua activa però ja no mou res.
          moving: segment.movingLineIds.indexOf(action.lineId) > -1,
          complete: action.complete,
          incompleteReason: action.incompleteReason,
        }))
      : [];

    // Les línies que mouen producte de debò en aquest instant: durant la
    // cua d'una acció que s'ha quedat sense producte no n'hi ha cap.
    state.activeLineIds = running ? [...segment.movingLineIds] : [];
    state.warnings = compiled.warnings.filter((warning) => warning.atSeconds <= time);

    return state;
  }

  // Errors i avisos sense haver de mirar els trams. Fa servir la mateixa
  // compilació perquè els avisos de "es buidarà" i "passa de capacitat"
  // només es poden saber un cop feta; així no hi ha dues llistes que puguin
  // acabar dient coses diferents.
  function validate(scenario) {
    const compiled = compile(scenario);
    return { ok: compiled.ok, errors: compiled.errors, warnings: compiled.warnings };
  }

  return {
    SECONDS_PER_HOUR,
    MOVES_PRODUCT,
    compile,
    stateAt,
    validate,
    segmentAt,
  };
})();
