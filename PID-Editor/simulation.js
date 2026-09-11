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
  // buildAction(), que és qui decideix quins trams genera cada acció.
  //
  // Les claus han de coincidir amb ProcessModel.ACTION_TYPES; hi ha una
  // prova automàtica que comprova que no se'n desincronitzin.
  const MOVES_PRODUCT = {
    transport: true,
    rest: false,
    sweep: false,
    startup: false,
  };

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

    return errors;
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
    const actions = [];
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

    // Afegeix un tram i avança l'estat fins al seu final.
    // `movement` és null quan el tram no mou res, o
    // { lineId, storageId, consumptionId, perHour, moved } quan sí.
    function pushSegment(from, to, action, movement) {
      const segment = {
        index: segments.length,
        startTime: from,
        endTime: to,
        actionOrder: action.order,
        actionType: action.type,
        lineId: movement ? movement.lineId : '',
        moving: Boolean(movement),
        storages: {},
        consumptions: {},
        lines: {},
      };

      const entry = (value, perHour) => ({
        start: value,
        ratePerHour: perHour,        // el número autoritatiu: els càlculs el fan servir
        rate: perHour / SECONDS_PER_HOUR, // el mateix en kg/s, per ensenyar-lo
      });

      storageIds.forEach((id) => {
        const perHour = movement && movement.storageId === id ? -movement.perHour : 0;
        segment.storages[id] = entry(current.storages[id], perHour);
      });
      consumptionIds.forEach((id) => {
        const perHour = movement && movement.consumptionId === id ? movement.perHour : 0;
        segment.consumptions[id] = entry(current.consumptions[id], perHour);
      });
      lineIds.forEach((id) => {
        const perHour = movement && movement.lineId === id ? movement.perHour : 0;
        segment.lines[id] = entry(current.lines[id], perHour);
      });

      segments.push(segment);

      if (!movement) return;

      // Avís de capacitat: l'instant exacte en què el punt de consum passa
      // de la seva capacitat màxima, dins d'aquest tram.
      const target = safe.consumptions[movement.consumptionId];
      const capacity = Number(target.capacity) || 0;
      const before = current.consumptions[movement.consumptionId];
      if (capacity > 0 && exceededAt[movement.consumptionId] === undefined
          && before + movement.moved > capacity) {
        exceededAt[movement.consumptionId] = before >= capacity
          ? from
          : from + ((capacity - before) * SECONDS_PER_HOUR) / movement.perHour;
      }

      // `moved` ja ve calculat pel cridador i, quan el tram acaba just al
      // buidar-se l'element, és exactament el que hi quedava: la resta dona
      // zero exacte i no una engruna en coma flotant.
      current.storages[movement.storageId] -= movement.moved;
      current.consumptions[movement.consumptionId] += movement.moved;
      current.lines[movement.lineId] += movement.moved;

      if (current.storages[movement.storageId] <= 0 && emptiedAt[movement.storageId] === undefined) {
        emptiedAt[movement.storageId] = to;
      }
    }

    // Genera els trams d'una acció i en retorna el resultat.
    //
    // Aquí és on s'hi afegirien més límits físics (pressió mínima, cabal
    // màxim de la canonada, temps de posada a règim...): cada límit nou és
    // un moment clau més i, per tant, un tall de tram més. El patró a
    // seguir és el de l'element que es buida: calcular l'instant exacte,
    // tallar-hi el tram i marcar l'acció.
    function buildAction(action, startTime) {
      const endTime = startTime + action.duration;
      const result = {
        order: action.order,
        type: action.type,
        lineId: action.lineId || '',
        startTime,
        endTime,
        duration: action.duration,
        moving: false,
        transferred: 0,
        complete: true,
        incompleteReason: '',
      };

      if (!MOVES_PRODUCT[action.type]) {
        pushSegment(startTime, endTime, action, null);
        return result;
      }

      const line = safe.lines[action.lineId];
      const perHour = Number(line.throughput);
      const storageId = line.storageId;
      const available = current.storages[storageId];

      // Límit físic: una línia no pot transferir mai més del que queda.
      if (!(available > 0)) {
        pushSegment(startTime, endTime, action, null);
        result.complete = false;
        result.incompleteReason = 'storage-empty';
        return result;
      }

      result.moving = true;
      const movement = { lineId: action.lineId, storageId, consumptionId: line.consumptionId, perHour };

      // Multiplicar primer i dividir per 3600 al final (i no convertir el
      // cabal a kg/s abans) evita l'arrodoniment: 600 kg/h durant 600 s
      // dona 100 kg exactes, no 99,999999999999.
      const wanted = (perHour * action.duration) / SECONDS_PER_HOUR;

      if (wanted <= available) {
        pushSegment(startTime, endTime, action, { ...movement, moved: wanted });
        result.transferred = wanted;
        return result;
      }

      // S'esgota enmig de l'acció. L'instant surt de dividir la massa que
      // queda pel cabal: és exacte, no el següent pas d'un rellotge.
      const emptyTime = startTime + (available * SECONDS_PER_HOUR) / perHour;
      pushSegment(startTime, emptyTime, action, { ...movement, moved: available });
      if (emptyTime < endTime) pushSegment(emptyTime, endTime, action, null);

      result.transferred = available;
      result.complete = false;
      result.incompleteReason = 'storage-empty';
      return result;
    }

    // Execució estrictament seqüencial: cada acció comença on acaba
    // l'anterior. Els trams porten inici i final absoluts, de manera que el
    // dia que s'hagin de permetre accions en paral·lel el que canviarà és
    // com es decideixen aquests inicis, no la resta del motor.
    let time = 0;
    (safe.actions || []).forEach((action) => {
      const result = buildAction(action, time);
      actions.push(result);
      time = result.endTime;
    });

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
      totalDuration: time,
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
      action: null,
      activeLineId: '',
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
    const action = compiled.actions.find((item) => item.order === segment.actionOrder) || null;

    if (action) {
      state.action = {
        order: action.order,
        type: action.type,
        lineId: action.lineId,
        startTime: action.startTime,
        endTime: action.endTime,
        duration: action.duration,
        progress: action.duration > 0
          ? Math.min(Math.max((time - action.startTime) / action.duration, 0), 1)
          : 1,
        complete: action.complete,
        incompleteReason: action.incompleteReason,
      };
    }

    // La línia activa només compta mentre es mou producte de debò: durant
    // la cua d'una acció que s'ha quedat sense producte no n'hi ha cap.
    state.activeLineId = (segment.moving && time < segment.endTime) ? segment.lineId : '';
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
