// ---- Proves del motor de simulació ----
// Cap d'aquestes proves obre cap pantalla ni toca el diagrama: només
// construeixen escenaris (objectes plans) i comproven els números que en
// surten. Vegeu docs/SIMULATION.md.

const { assert } = Test;

// ---- Ajudes per muntar escenaris ----
const minutes = (value) => value * 60;

const storage = (name, product, quantity, capacity = 0) => ({ name, product, quantity, capacity });

const consumption = (name, product, quantity = 0, capacity = 0) => ({ name, product, quantity, capacity });

const line = (name, throughput, storageId, consumptionId, extra = {}) => ({
  name,
  throughput,
  configured: true,
  pickupId: `pickup-${name}`,
  pickupName: `Injector de ${name}`,
  consumptionId,
  storageId,
  storageStatus: 'found',
  pumps: ['Bomba de proves'],
  // Recorregut propi per defecte: cada línia passa pels seus elements i per
  // ningú més, o sigui que dues línies diferents no es trepitgen.
  route: {
    elements: [`pickup-${name}`, consumptionId],
    connectors: [`pipe-${name}`],
    labels: { [`pickup-${name}`]: `Injector de ${name}`, [consumptionId]: consumptionId },
  },
  ...extra,
});

// Fa servir el model de seqüència de ProcessModel, de manera que les proves
// també el cobreixen.
function scenario(spec) {
  return {
    storages: spec.storages || {},
    consumptions: spec.consumptions || {},
    lines: spec.lines || {},
    pumps: spec.pumps || { P: { name: 'Bomba de proves' } },
    actions: ProcessModel.normalizeSequence(
      spec.parallel ? spec.actions || [] : inSeries(spec.actions || []),
    ),
  };
}

const transport = (lineId, duration) => ({ type: 'transport', lineId, duration });
const rest = (duration) => ({ type: 'rest', duration });

// Encadena les accions una darrere l'altra, que és com anaven abans que hi
// hagués cronograma en paral·lel. Les proves que no parlin de paral·lelisme
// han de continuar donant exactament els mateixos números.
function inSeries(actions, pumpId) {
  let time = 0;
  return actions.map((action) => {
    const chained = { ...action, pumpId: pumpId || 'P', startTime: time };
    time += action.duration;
    return chained;
  });
}

// Escenari base: un silo, una tolva i una línia. Els paràmetres canvien.
function simple(quantity, throughput, actions, extra = {}) {
  return scenario({
    storages: { S: storage('Silo de farina', 'Farina', quantity, extra.storageCapacity || 0) },
    consumptions: { C: consumption('Amassadora', 'Farina', 0, extra.capacity || 0) },
    lines: { L: line('Línia 1', throughput, 'S', 'C') },
    actions,
  });
}

// =====================================================================
Test.group('Prova 1 — transport que cap de sobres');

Test.case('1.000 kg a 600 kg/h durant 10 min mou exactament 100 kg', () => {
  const compiled = SimulationEngine.compile(simple(1000, 600, [transport('L', minutes(10))]));
  assert.isTrue(compiled.ok, 'la compilació');

  const end = SimulationEngine.stateAt(compiled, minutes(10));
  assert.equal(end.lines.L, 100, 'kg transferits per la línia');
  assert.equal(end.storages.S, 900, 'kg que queden al silo');
  assert.equal(end.consumptions.C, 100, 'kg rebuts al punt de consum');
  assert.equal(compiled.actions[0].transferred, 100, 'kg de l\'acció');
  assert.isTrue(compiled.actions[0].complete, 'acció completa');
});

Test.case('a mig camí (5 min) n\'ha mogut exactament la meitat', () => {
  const compiled = SimulationEngine.compile(simple(1000, 600, [transport('L', minutes(10))]));
  const half = SimulationEngine.stateAt(compiled, minutes(5));
  assert.equal(half.lines.L, 50, 'kg transferits');
  assert.equal(half.storages.S, 950, 'kg al silo');
  assert.equal(half.actions[0].progress, 0.5, 'progrés de l\'acció');
  assert.deepEqual(half.activeLineIds, ['L'], 'línia activa');
});

// =====================================================================
Test.group('Prova 2 — el silo es queda sense producte');

Test.case('50 kg a 600 kg/h durant 10 min només mou 50 kg i queda incompleta', () => {
  const compiled = SimulationEngine.compile(simple(50, 600, [transport('L', minutes(10))]));
  assert.isTrue(compiled.ok, 'la compilació');

  const end = SimulationEngine.stateAt(compiled, minutes(10));
  assert.equal(end.lines.L, 50, 'kg transferits');
  assert.equal(end.storages.S, 0, 'kg que queden al silo');
  assert.equal(end.consumptions.C, 50, 'kg rebuts');

  const action = compiled.actions[0];
  assert.equal(action.transferred, 50, 'kg de l\'acció');
  assert.isFalse(action.complete, 'acció completa');
  assert.equal(action.incompleteReason, 'storage-empty', 'motiu');
});

Test.case('després de buidar-se, l\'acció ocupa el temps però no mou res', () => {
  const compiled = SimulationEngine.compile(simple(50, 600, [transport('L', minutes(10))]));
  const later = SimulationEngine.stateAt(compiled, minutes(7));
  assert.equal(later.lines.L, 50, 'kg transferits al minut 7');
  assert.equal(later.activeLineIds.length, 0, 'cap línia activa un cop buit');
  assert.equal(later.actions[0].order, 1, 'l\'acció encara és la 1');
});

// =====================================================================
Test.group('Prova 3 — seqüència amb un descans pel mig');

Test.case('5 min transport + 2 min descans + 5 min transport mou 25 + 0 + 25 = 50 kg', () => {
  const compiled = SimulationEngine.compile(simple(1000, 300, [
    transport('L', minutes(5)),
    rest(minutes(2)),
    transport('L', minutes(5)),
  ]));
  assert.isTrue(compiled.ok, 'la compilació');
  assert.equal(compiled.totalDuration, minutes(12), 'durada total');

  assert.equal(compiled.actions[0].transferred, 25, 'acció 1');
  assert.equal(compiled.actions[1].transferred, 0, 'acció 2 (descans)');
  assert.equal(compiled.actions[2].transferred, 25, 'acció 3');

  const end = SimulationEngine.stateAt(compiled, minutes(12));
  assert.equal(end.lines.L, 50, 'kg transferits en total');
  assert.equal(end.storages.S, 950, 'kg al silo');
  assert.equal(end.consumptions.C, 50, 'kg rebuts');
});

Test.case('durant el descans no es mou res', () => {
  const compiled = SimulationEngine.compile(simple(1000, 300, [
    transport('L', minutes(5)),
    rest(minutes(2)),
    transport('L', minutes(5)),
  ]));
  const during = SimulationEngine.stateAt(compiled, minutes(6));
  assert.equal(during.lines.L, 25, 'kg transferits');
  assert.equal(during.actions[0].type, 'rest', 'tipus d\'acció');
  assert.equal(during.activeLineIds.length, 0, 'cap línia activa');
});

// =====================================================================
Test.group('Prova 4 — el resultat no depèn del camí');

Test.case('el minut 3 dona exactament el mateix tant si s\'hi va directe com endavant o enrere', () => {
  const compiled = SimulationEngine.compile(simple(1000, 300, [
    transport('L', minutes(10)),
    rest(minutes(5)),
    transport('L', minutes(10)),
  ]));

  const direct = SimulationEngine.stateAt(compiled, minutes(3));

  SimulationEngine.stateAt(compiled, minutes(8));
  const afterJumpingForward = SimulationEngine.stateAt(compiled, minutes(3));

  [20, 18, 15, 12, 9, 6, 4].forEach((m) => SimulationEngine.stateAt(compiled, minutes(m)));
  const afterWalkingBack = SimulationEngine.stateAt(compiled, minutes(3));

  // Passos desiguals, com si s'arrossegués el cursor a velocitats diferents.
  [0, 24.7, 1.3, 19.999, 3.0001, 2.9999].forEach((m) => SimulationEngine.stateAt(compiled, minutes(m)));
  const afterRandomSeeks = SimulationEngine.stateAt(compiled, minutes(3));

  assert.deepEqual(direct, afterJumpingForward, 'directe contra endavant');
  assert.deepEqual(direct, afterWalkingBack, 'directe contra enrere');
  assert.deepEqual(direct, afterRandomSeeks, 'directe contra salts desiguals');

  // I, a més, el número és el que diuen les matemàtiques: 300 kg/h × 180 s.
  assert.equal(direct.lines.L, 15, 'kg al minut 3');
});

// =====================================================================
Test.group('Prova 5 — l\'instant en què es buida és exacte');

Test.case('50 kg a 600 kg/h es buiden al segon 300 clavat', () => {
  const compiled = SimulationEngine.compile(simple(50, 600, [transport('L', minutes(10))]));
  assert.equal(compiled.segments[0].endTime, 300, 'final del tram que mou producte');
  assert.isTrue(compiled.keyTimes.includes(300), 'el segon 300 és un moment clau');
  assert.equal(SimulationEngine.stateAt(compiled, 300).storages.S, 0, 'kg al segon 300');
  assert.isTrue(SimulationEngine.stateAt(compiled, 299.999).storages.S > 0, 'encara queda al segon 299,999');
});

Test.case('amb un cabal que no dona un número rodó, l\'instant continua sent l\'exacte', () => {
  // 50 kg a 700 kg/h = 257,142857... s. No és cap múltiple d'un pas de temps.
  const compiled = SimulationEngine.compile(simple(50, 700, [transport('L', minutes(10))]));
  const exact = (50 * 3600) / 700;
  assert.equal(compiled.segments[0].endTime, exact, 'instant en què es buida');
  assert.equal(SimulationEngine.stateAt(compiled, exact).storages.S, 0, 'kg en aquell instant');
  assert.notEqual(exact, Math.round(exact), 'l\'instant no és cap número rodó');
});

// =====================================================================
Test.group('Prova 6 — escenari amb diversos elements alhora');

function multiScenario() {
  return scenario({
    storages: {
      SILO: storage('Silo de farina', 'Farina', 500),
      SACS: storage('Descàrrega de sacs', 'Sucre', 120),
    },
    consumptions: {
      AMAS: consumption('Amassadora 1', 'Farina', 0, 400),
      DOSI: consumption('Dosificadora', 'Sucre', 30, 500),
    },
    lines: {
      LA: line('Farina cap a amassadora', 600, 'SILO', 'AMAS'),
      LB: line('Sucre cap a dosificadora', 240, 'SACS', 'DOSI'),
    },
    actions: [
      transport('LA', minutes(10)),   // 100 kg de farina
      transport('LB', minutes(15)),   // 60 kg de sucre
      rest(minutes(3)),
      transport('LA', minutes(20)),   // 200 kg de farina
    ],
  });
}

Test.case('cada element porta el seu compte, sense barrejar-se', () => {
  const compiled = SimulationEngine.compile(multiScenario());
  assert.isTrue(compiled.ok, 'la compilació');
  assert.equal(compiled.totalDuration, minutes(48), 'durada total');

  const end = SimulationEngine.stateAt(compiled, minutes(48));
  assert.equal(end.storages.SILO, 200, 'farina que queda al silo');
  assert.equal(end.storages.SACS, 60, 'sucre que queda als sacs');
  assert.equal(end.consumptions.AMAS, 300, 'farina rebuda a l\'amassadora');
  assert.equal(end.consumptions.DOSI, 90, 'sucre a la dosificadora (30 inicials + 60)');
  assert.equal(end.lines.LA, 300, 'kg per la línia de farina');
  assert.equal(end.lines.LB, 60, 'kg per la línia de sucre');
});

Test.case('enmig de la segona acció, la primera línia ja no es mou', () => {
  const compiled = SimulationEngine.compile(multiScenario());
  const during = SimulationEngine.stateAt(compiled, minutes(20));   // dins de l'acció 2
  assert.equal(during.actions[0].order, 2, 'acció activa');
  assert.deepEqual(during.activeLineIds, ['LB'], 'línia activa');
  assert.equal(during.lines.LA, 100, 'la línia de farina es queda on era');
  assert.equal(during.lines.LB, 40, 'la de sucre porta 10 min a 240 kg/h');
  assert.equal(during.storages.SILO, 400, 'el silo no baixa mentre no és el seu torn');
});

// =====================================================================
Test.group('Prova 7 — dues línies des del mateix element');

Test.case('els kg es descompten del mateix silo de manera acumulativa', () => {
  const compiled = SimulationEngine.compile(scenario({
    storages: { S: storage('Silo compartit', 'Farina', 100) },
    consumptions: {
      C1: consumption('Consum 1', 'Farina'),
      C2: consumption('Consum 2', 'Farina'),
    },
    lines: {
      L1: line('Cap al consum 1', 600, 'S', 'C1'),
      L2: line('Cap al consum 2', 600, 'S', 'C2'),
    },
    actions: [
      transport('L1', minutes(5)),   // 50 kg
      transport('L2', minutes(5)),   // 50 kg, del mateix silo
      transport('L1', minutes(1)),   // ja no en queda
    ],
  }));
  assert.isTrue(compiled.ok, 'la compilació');

  const afterFirst = SimulationEngine.stateAt(compiled, minutes(5));
  assert.equal(afterFirst.storages.S, 50, 'silo després de la primera acció');

  const end = SimulationEngine.stateAt(compiled, minutes(11));
  assert.equal(end.storages.S, 0, 'silo al final');
  assert.equal(end.consumptions.C1, 50, 'consum 1');
  assert.equal(end.consumptions.C2, 50, 'consum 2');
  assert.equal(end.lines.L1, 50, 'línia 1');
  assert.equal(end.lines.L2, 50, 'línia 2');

  assert.isTrue(compiled.actions[0].complete, 'acció 1 completa');
  assert.isTrue(compiled.actions[1].complete, 'acció 2 completa');
  assert.isFalse(compiled.actions[2].complete, 'acció 3 completa');
  assert.equal(compiled.actions[2].transferred, 0, 'acció 3 no mou res');
});

// =====================================================================
Test.group('Prova 8 — la validació detecta cada cas');

function expectError(code, spec, what) {
  const report = SimulationEngine.validate(scenario(spec));
  assert.isFalse(report.ok, `${what}: hauria de bloquejar`);
  assert.hasCode(report.errors, code, what);
  assert.readableMessages(report.errors, what);
}

Test.case('seqüència buida', () => {
  expectError('empty-sequence', { actions: [] }, 'seqüència buida');
});

Test.case('durada zero o negativa', () => {
  const base = {
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C: consumption('Consum', 'Farina') },
    lines: { L: line('L', 600, 'S', 'C') },
  };
  expectError('invalid-duration', { ...base, actions: [transport('L', 0)] }, 'durada zero');
  expectError('invalid-duration', { ...base, actions: [transport('L', -60)] }, 'durada negativa');
});

Test.case('línia no configurada i línia sense rendiment', () => {
  const base = {
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C: consumption('Consum', 'Farina') },
    actions: [transport('L', minutes(5))],
  };
  expectError('line-not-configured',
    { ...base, lines: { L: line('L', 0, 'S', 'C', { configured: false }) } }, 'línia no configurada');
  expectError('line-no-throughput',
    { ...base, lines: { L: line('L', 0, 'S', 'C') } }, 'línia sense rendiment');
});

Test.case('acció de transport sense línia assignada', () => {
  expectError('missing-line', {
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C: consumption('Consum', 'Farina') },
    lines: {},
    actions: [{ type: 'transport', lineId: '', duration: minutes(5) }],
  }, 'sense línia');
});

Test.case('línia sense origen i línia sense destí', () => {
  const base = {
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C: consumption('Consum', 'Farina') },
    actions: [transport('L', minutes(5))],
  };
  expectError('line-without-source',
    { ...base, lines: { L: line('L', 600, 'S', 'C', { pickupId: '' }) } }, 'sense origen');
  expectError('line-without-target',
    { ...base, lines: { L: line('L', 600, 'S', '') } }, 'sense destí');
});

Test.case('pick-up point sense element d\'emmagatzematge detectat', () => {
  expectError('storage-not-detected', {
    storages: {},
    consumptions: { C: consumption('Consum', 'Farina') },
    lines: { L: line('L', 600, '', 'C', { storageStatus: 'none' }) },
    actions: [transport('L', minutes(5))],
  }, 'sense magatzem');
});

Test.case('pick-up point amb detecció ambigua sense resoldre', () => {
  expectError('storage-ambiguous', {
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C: consumption('Consum', 'Farina') },
    lines: { L: line('L', 600, 'S', 'C', { storageStatus: 'ambiguous' }) },
    actions: [transport('L', minutes(5))],
  }, 'ambigu');
});

Test.case('element d\'emmagatzematge sense quantitat', () => {
  expectError('storage-empty', {
    storages: { S: storage('Silo buit', 'Farina', 0) },
    consumptions: { C: consumption('Consum', 'Farina') },
    lines: { L: line('L', 600, 'S', 'C') },
    actions: [transport('L', minutes(5))],
  }, 'silo buit');
});

Test.case('productes incompatibles', () => {
  expectError('product-mismatch', {
    storages: { S: storage('Silo de farina', 'Farina', 100) },
    consumptions: { C: consumption('Dipòsit de sucre', 'Sucre') },
    lines: { L: line('L', 600, 'S', 'C') },
    actions: [transport('L', minutes(5))],
  }, 'productes diferents');
});

Test.case('un producte encara sense definir no bloqueja', () => {
  const report = SimulationEngine.validate(scenario({
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C: consumption('Consum nou', '') },
    lines: { L: line('L', 600, 'S', 'C') },
    actions: [transport('L', minutes(5))],
  }));
  assert.isTrue(report.ok, 'hauria de deixar simular');
  assert.lacksCode(report.errors, 'product-mismatch', 'errors');
});

Test.case('avís: el silo s\'esgotarà durant la seqüència, i diu quan', () => {
  const report = SimulationEngine.validate(simple(50, 600, [transport('L', minutes(10))]));
  assert.isTrue(report.ok, 'els avisos no bloquegen');
  assert.hasCode(report.warnings, 'storage-will-empty', 'avisos');
  assert.readableMessages(report.warnings, 'avisos');
  const warning = report.warnings.find((w) => w.code === 'storage-will-empty');
  assert.equal(warning.atSeconds, 300, 'instant de l\'avís');
  assert.isTrue(warning.message.includes('minut 5'), 'el missatge diu el minut');
});

Test.case('avís: el punt de consum passa de la seva capacitat', () => {
  const report = SimulationEngine.validate(simple(1000, 600, [transport('L', minutes(30))], { capacity: 200 }));
  assert.isTrue(report.ok, 'els avisos no bloquegen');
  assert.hasCode(report.warnings, 'capacity-exceeded', 'avisos');
  const warning = report.warnings.find((w) => w.code === 'capacity-exceeded');
  assert.equal(warning.atSeconds, minutes(20), 'instant en què passa de 200 kg a 600 kg/h');
});

Test.case('errors i avisos van per separat i no es barregen', () => {
  const report = SimulationEngine.validate(scenario({
    storages: { S: storage('Silo buit', 'Farina', 0) },
    consumptions: { C: consumption('Consum', 'Farina') },
    lines: { L: line('L', 600, 'S', 'C') },
    actions: [transport('L', minutes(5))],
  }));
  assert.isFalse(report.ok, 'hi ha error');
  assert.equal(report.warnings.length, 0, 'quan hi ha errors no es donen avisos a mitges');
});

// =====================================================================
// Casos límit que no eren a la llista però que podrien donar números
// incorrectes. Vegeu l'informe.
Test.group('Casos límit afegits');

Test.case('el motor no toca mai l\'escenari que rep', () => {
  const input = simple(1000, 600, [transport('L', minutes(10))]);
  const before = JSON.stringify(input);
  const compiled = SimulationEngine.compile(input);
  SimulationEngine.stateAt(compiled, minutes(4));
  SimulationEngine.validate(input);
  assert.equal(JSON.stringify(input), before, 'l\'escenari d\'entrada');
});

Test.case('la massa es conserva amb un cabal que no divideix bé', () => {
  // 777 kg/h durant 7 minuts: cap dels números surt rodó. La quantitat que
  // baixa del silo i la que puja al consum han de quadrar. No poden quadrar
  // xifra a xifra: 90,65 kg no es pot escriure exactament en binari i la
  // resta 1000 − 90,65 s'arrodoneix a la quinzena xifra decimal. El marge
  // que s'accepta aquí (una milmilionèsima de kg) continua sent milions de
  // vegades més petit que qualsevol cosa mesurable en una instal·lació.
  const compiled = SimulationEngine.compile(simple(1000, 777, [transport('L', minutes(7))]));
  const end = SimulationEngine.stateAt(compiled, minutes(7));
  const lost = (1000 - end.storages.S) - end.consumptions.C;
  assert.close(lost, 0, 1e-9, 'kg que es perden pel camí');
  assert.equal(end.consumptions.C, end.lines.L, 'kg rebuts contra kg transportats');
  assert.close(end.lines.L, (777 * 420) / 3600, 1e-12, 'kg transportats');
});

Test.case('consultar abans del començament o després del final no es dispara', () => {
  const compiled = SimulationEngine.compile(simple(1000, 600, [transport('L', minutes(10))]));
  const before = SimulationEngine.stateAt(compiled, -500);
  const after = SimulationEngine.stateAt(compiled, minutes(99));

  assert.equal(before.time, 0, 'temps abans de començar');
  assert.equal(before.storages.S, 1000, 'res s\'ha mogut encara');
  assert.equal(after.time, minutes(10), 'temps després d\'acabar');
  assert.equal(after.storages.S, 900, 'estat final');
  assert.isTrue(after.finished, 'marcat com a acabat');
  assert.deepEqual(after.storages, compiled.final.storages, 'el final no s\'interpola');
});

Test.case('descans, barrido i posada a règim ocupen temps i no mouen res', () => {
  const compiled = SimulationEngine.compile(scenario({
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C: consumption('Consum', 'Farina') },
    lines: { L: line('L', 600, 'S', 'C') },
    actions: [
      { type: 'rest', duration: minutes(2) },
      { type: 'sweep', duration: minutes(3) },
      { type: 'startup', duration: minutes(1) },
      transport('L', minutes(1)),
    ],
  }));
  assert.isTrue(compiled.ok, 'la compilació');
  assert.equal(compiled.totalDuration, minutes(7), 'durada total');

  const beforeTransport = SimulationEngine.stateAt(compiled, minutes(6));
  assert.equal(beforeTransport.storages.S, 100, 'el silo no s\'ha tocat');
  assert.equal(SimulationEngine.stateAt(compiled, minutes(7)).lines.L, 10, 'kg de l\'últim minut');
});

Test.case('una acció que buida el silo just al final compta com a completa', () => {
  // 100 kg a 600 kg/h durant 10 min: demana exactament el que hi ha.
  const compiled = SimulationEngine.compile(simple(100, 600, [transport('L', minutes(10))]));
  const end = SimulationEngine.stateAt(compiled, minutes(10));
  assert.equal(end.storages.S, 0, 'silo exactament buit');
  assert.equal(end.consumptions.C, 100, 'kg rebuts');
  assert.isTrue(compiled.actions[0].complete, 'acció completa: ha mogut tot el que demanava');
});

Test.case('els tipus d\'acció del motor i els del model no es poden desincronitzar', () => {
  const modelTypes = Object.values(ProcessModel.ACTION_TYPES).sort();
  const engineTypes = Object.keys(SimulationEngine.MOVES_PRODUCT).sort();
  assert.deepEqual(engineTypes, modelTypes, 'tipus d\'acció');
});

Test.case('la seqüència es renumera sola encara que arribi desordenada', () => {
  const actions = ProcessModel.normalizeSequence([
    { type: 'transport', lineId: 'L', duration: 60, order: 9 },
    { type: 'rest', duration: 30, order: 4 },
  ]);
  assert.deepEqual(actions.map((a) => a.order), [1, 2], 'ordre');
  assert.equal(actions[0].duration, 60, 'durada conservada');
});

Test.case('dues compilacions del mateix escenari donen exactament el mateix', () => {
  const input = multiScenario();
  const a = SimulationEngine.compile(input);
  const b = SimulationEngine.compile(input);
  assert.deepEqual(a.segments, b.segments, 'trams');
  assert.deepEqual(a.final, b.final, 'situació final');
  assert.deepEqual(
    SimulationEngine.stateAt(a, minutes(23.7)),
    SimulationEngine.stateAt(b, minutes(23.7)),
    'estat al minut 23,7',
  );
});

// =====================================================================
Test.group('La seqüència es desa amb el model');

Test.case('surt a serialize() i torna a load()', () => {
  ProcessModel.clear();
  ProcessModel.setSequence([
    transport('L', minutes(7)),
    rest(minutes(2)),
  ]);

  const saved = ProcessModel.serialize();
  assert.equal(saved.sequence.length, 2, 'accions desades');
  assert.equal(saved.sequence[0].duration, 420, 'durada en segons');

  ProcessModel.clear();
  assert.equal(ProcessModel.getSequence().length, 0, 'després de buidar');

  ProcessModel.load(saved);
  assert.deepEqual(ProcessModel.getSequence(), saved.sequence, 'seqüència recuperada');
});

Test.case('un model d\'abans que es desés obre amb la seqüència buida', () => {
  ProcessModel.setSequence([transport('L', minutes(3))]);
  ProcessModel.load({ elements: {}, lines: {} });
  assert.equal(ProcessModel.getSequence().length, 0, 'seqüència');
});

Test.case('una seqüència desordenada o incompleta es normalitza en obrir-la', () => {
  ProcessModel.load({
    elements: {},
    lines: {},
    sequence: [
      { type: 'rest', duration: 60, order: 9 },
      { type: 'transport', lineId: 'L', duration: 120 },
    ],
  });

  const sequence = ProcessModel.getSequence();
  assert.deepEqual(sequence.map((a) => a.order), [1, 2], 'ordre renumerat');
  assert.equal(sequence[0].lineId, '', 'camp que faltava, amb el valor per defecte');
  assert.equal(sequence[1].duration, 120, 'durada conservada');
});

Test.case('getSequence() retorna una còpia: tocar-la no toca el model', () => {
  ProcessModel.setSequence([transport('L', minutes(5))]);
  const copy = ProcessModel.getSequence();
  copy[0].duration = 999;
  assert.equal(ProcessModel.getSequence()[0].duration, 300, 'durada al model');
});

// =====================================================================
Test.group('Accions en paral·lel');

Test.case('dues línies de bombes diferents transporten alhora', () => {
  // 600 kg/h i 300 kg/h durant 10 min, cada una des del seu magatzem.
  const compiled = SimulationEngine.compile(scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' }, B: { name: 'Bomba B' } },
    storages: {
      SA: storage('Silo A', 'Farina', 1000),
      SB: storage('Silo B', 'Sucre', 1000),
    },
    consumptions: {
      CA: consumption('Consum A', 'Farina'),
      CB: consumption('Consum B', 'Sucre'),
    },
    lines: {
      LA: line('LA', 600, 'SA', 'CA'),
      LB: line('LB', 300, 'SB', 'CB'),
    },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'LA', startTime: 0, duration: minutes(10) },
      { type: 'transport', pumpId: 'B', lineId: 'LB', startTime: 0, duration: minutes(10) },
    ],
  }));

  assert.isTrue(compiled.ok, 'la compilació');
  assert.equal(compiled.totalDuration, minutes(10), 'durada total: van alhora, no seguides');

  const end = SimulationEngine.stateAt(compiled, minutes(10));
  assert.equal(end.storages.SA, 900, 'silo A');
  assert.equal(end.storages.SB, 950, 'silo B');
  assert.equal(end.consumptions.CA, 100, 'consum A');
  assert.equal(end.consumptions.CB, 50, 'consum B');

  const half = SimulationEngine.stateAt(compiled, minutes(5));
  assert.equal(half.actions.length, 2, 'dues accions actives alhora');
  assert.equal(half.activeLineIds.sort().join(','), 'LA,LB', 'dues línies movent producte');
});

Test.case('dues línies des del MATEIX magatzem el buiden amb la suma dels cabals', () => {
  // 100 kg, dues línies de 600 kg/h alhora: la suma és 1.200 kg/h, o sigui
  // que es buida en 100 / 1200 h = 5 minuts, no en 10.
  const compiled = SimulationEngine.compile(scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' }, B: { name: 'Bomba B' } },
    storages: { S: storage('Silo compartit', 'Farina', 100) },
    consumptions: {
      C1: consumption('Consum 1', 'Farina'),
      C2: consumption('Consum 2', 'Farina'),
    },
    lines: {
      L1: line('L1', 600, 'S', 'C1'),
      L2: line('L2', 600, 'S', 'C2'),
    },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'L1', startTime: 0, duration: minutes(10) },
      { type: 'transport', pumpId: 'B', lineId: 'L2', startTime: 0, duration: minutes(10) },
    ],
  }));

  assert.isTrue(compiled.ok, 'la compilació');
  assert.isTrue(compiled.keyTimes.includes(300), 'el minut 5 és un moment clau');

  const empty = SimulationEngine.stateAt(compiled, 300);
  assert.equal(empty.storages.S, 0, 'el silo es buida al minut 5 clavat');
  assert.equal(empty.consumptions.C1, 50, 'meitat per a cada línia');
  assert.equal(empty.consumptions.C2, 50, 'meitat per a cada línia');
  assert.isTrue(SimulationEngine.stateAt(compiled, 299).storages.S > 0, 'al minut 4:59 encara en queda');

  // Totes dues s'aturen en aquell mateix instant.
  const later = SimulationEngine.stateAt(compiled, minutes(9));
  assert.equal(later.consumptions.C1, 50, 'després no arriba res més');
  assert.equal(later.consumptions.C2, 50, 'després no arriba res més');
  assert.equal(later.activeLineIds.length, 0, 'cap línia movent producte');

  compiled.actions.forEach((action) => {
    assert.isFalse(action.complete, `acció ${action.order} completa`);
    assert.equal(action.transferred, 50, `acció ${action.order}: kg moguts`);
  });
});

Test.case('cabals diferents des del mateix magatzem reparteixen en proporció', () => {
  // 900 kg/h i 300 kg/h: la suma és 1.200 kg/h i 100 kg duren 5 minuts,
  // dels quals 75 kg se'n van per la primera i 25 per la segona.
  const compiled = SimulationEngine.compile(scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' }, B: { name: 'Bomba B' } },
    storages: { S: storage('Silo', 'Farina', 100) },
    consumptions: { C1: consumption('Consum 1', 'Farina'), C2: consumption('Consum 2', 'Farina') },
    lines: { L1: line('L1', 900, 'S', 'C1'), L2: line('L2', 300, 'S', 'C2') },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'L1', startTime: 0, duration: minutes(10) },
      { type: 'transport', pumpId: 'B', lineId: 'L2', startTime: 0, duration: minutes(10) },
    ],
  }));

  const end = SimulationEngine.stateAt(compiled, minutes(10));
  assert.equal(end.storages.S, 0, 'silo buit');
  assert.close(end.consumptions.C1, 75, 1e-9, 'tres quartes parts');
  assert.close(end.consumptions.C2, 25, 1e-9, 'una quarta part');
  assert.close(end.consumptions.C1 + end.consumptions.C2, 100, 1e-9, 'i tot plegat, els 100 kg');
});

Test.case('accions que se solapen a mitges: els moments clau són tots', () => {
  const compiled = SimulationEngine.compile(scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' }, B: { name: 'Bomba B' } },
    storages: { SA: storage('A', 'Farina', 1000), SB: storage('B', 'Sucre', 1000) },
    consumptions: { CA: consumption('CA', 'Farina'), CB: consumption('CB', 'Sucre') },
    lines: { LA: line('LA', 600, 'SA', 'CA'), LB: line('LB', 600, 'SB', 'CB') },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'LA', startTime: 0, duration: minutes(10) },
      { type: 'transport', pumpId: 'B', lineId: 'LB', startTime: minutes(6), duration: minutes(10) },
    ],
  }));

  assert.equal(compiled.totalDuration, minutes(16), 'durada total');
  assert.deepEqual(compiled.keyTimes, [0, 360, 600, 960], 'moments clau');

  // Al minut 8 la primera porta 8 min i la segona 2.
  const state = SimulationEngine.stateAt(compiled, minutes(8));
  assert.equal(state.consumptions.CA, 80, 'la primera');
  assert.equal(state.consumptions.CB, 20, 'la segona');
});

// =====================================================================
Test.group('Conflictes entre accions simultànies');

function conflictScenario(routeB, startB) {
  return scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' }, B: { name: 'Bomba B' } },
    storages: { S: storage('Silo', 'Farina', 1000) },
    consumptions: { C1: consumption('C1', 'Farina'), C2: consumption('C2', 'Farina') },
    lines: {
      LA: line('LA', 600, 'S', 'C1', {
        route: { elements: ['inj-1', 'valve-1', 'C1'], connectors: [], labels: { 'valve-1': 'Vàlvula 1' } },
      }),
      LB: line('LB', 600, 'S', 'C2', { route: routeB }),
    },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'LA', startTime: 0, duration: minutes(10) },
      { type: 'transport', pumpId: 'B', lineId: 'LB', startTime: startB, duration: minutes(10) },
    ],
  });
}

Test.case('recorreguts separats: poden anar alhora', () => {
  const report = SimulationEngine.validate(conflictScenario(
    { elements: ['inj-2', 'valve-2', 'C2'], connectors: [], labels: {} }, 0,
  ));
  assert.isTrue(report.ok, 'hauria de deixar simular');
});

Test.case('un element compartit: xoquen, i diu quin', () => {
  const report = SimulationEngine.validate(conflictScenario(
    { elements: ['inj-2', 'valve-1', 'C2'], connectors: [], labels: {} }, 0,
  ));
  assert.isFalse(report.ok, 'ha de bloquejar');
  assert.hasCode(report.errors, 'pipe-conflict', 'errors');

  const clash = report.errors.find((issue) => issue.code === 'pipe-conflict');
  assert.isTrue(clash.message.includes('Vàlvula 1'), 'diu per on xoquen');
  assert.isTrue(clash.message.includes('minut'), 'i quan');
  assert.deepEqual(clash.sharedElementIds, ['valve-1'], 'element compartit');
});

Test.case('el mateix element però sense solapar-se en el temps: cap problema', () => {
  const report = SimulationEngine.validate(conflictScenario(
    { elements: ['inj-2', 'valve-1', 'C2'], connectors: [], labels: {} }, minutes(10),
  ));
  assert.isTrue(report.ok, 'tocar-se no és solapar-se');
});

Test.case('una bomba no pot fer dues coses alhora', () => {
  const report = SimulationEngine.validate(scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' } },
    storages: { SA: storage('A', 'Farina', 1000), SB: storage('B', 'Farina', 1000) },
    consumptions: { CA: consumption('CA', 'Farina'), CB: consumption('CB', 'Farina') },
    lines: { LA: line('LA', 600, 'SA', 'CA'), LB: line('LB', 600, 'SB', 'CB') },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'LA', startTime: 0, duration: minutes(10) },
      { type: 'transport', pumpId: 'A', lineId: 'LB', startTime: minutes(5), duration: minutes(10) },
    ],
  }));

  assert.isFalse(report.ok, 'ha de bloquejar');
  assert.hasCode(report.errors, 'pump-conflict', 'errors');
  assert.isTrue(report.errors[0].message.includes('Bomba A'), 'diu quina bomba');
});

Test.case('un descans no ocupa canonada i pot anar alhora que un transport', () => {
  const report = SimulationEngine.validate(scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' }, B: { name: 'Bomba B' } },
    storages: { S: storage('Silo', 'Farina', 1000) },
    consumptions: { C: consumption('C', 'Farina') },
    lines: { L: line('L', 600, 'S', 'C') },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'L', startTime: 0, duration: minutes(10) },
      { type: 'rest', pumpId: 'B', startTime: 0, duration: minutes(10) },
    ],
  }));
  assert.isTrue(report.ok, 'el descans no ocupa cap canonada');
});

Test.case('un barrido amb línia SÍ que ocupa canonada', () => {
  const report = SimulationEngine.validate(scenario({
    parallel: true,
    pumps: { A: { name: 'Bomba A' }, B: { name: 'Bomba B' } },
    storages: { S: storage('Silo', 'Farina', 1000) },
    consumptions: { C: consumption('C', 'Farina') },
    lines: { L: line('L', 600, 'S', 'C') },
    actions: [
      { type: 'transport', pumpId: 'A', lineId: 'L', startTime: 0, duration: minutes(10) },
      { type: 'sweep', pumpId: 'B', lineId: 'L', startTime: minutes(2), duration: minutes(3) },
    ],
  }));
  assert.isFalse(report.ok, 'la mateixa línia no pot fer dues coses alhora');
  assert.hasCode(report.errors, 'pipe-conflict', 'errors');
});

Test.run();
